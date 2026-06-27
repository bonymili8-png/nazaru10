/* ===========================================================================
   save.js — get the recording (and exports) onto the user's device

   Strategy:
   - If the browser can share files (navigator.canShare({ files })) → use the
     Web Share API. On iOS this is the reliable way to get a video into
     Photos / Files; a plain <a download> often won't.
   - Otherwise → object-URL + <a download>, auto-clicked. Works on Android
     (lands in Downloads) and desktop.
   Always revoke object URLs afterward to avoid memory leaks.
   =========================================================================== */

/** Build a timestamped filename: teleprom-YYYYMMDD-HHMMSS.<ext> */
export function makeFilename(ext, prefix = 'teleprom') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
                `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${prefix}-${stamp}.${ext}`;
}

/**
 * Save a video Blob to the device. Returns a short string describing how it
 * was saved ("shared" | "downloaded") or throws/aborts.
 */
export async function saveVideo(blob, filename, mimeType) {
  const file = new File([blob], filename, { type: mimeType || blob.type });

  // Preferred path: Web Share API with files (best on iOS).
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      // User cancelled the share sheet — not a real error.
      if (err && err.name === 'AbortError') return 'cancelled';
      // Otherwise fall through to the download path.
    }
  }

  // Fallback: object URL + download link (Android / desktop).
  downloadBlob(blob, filename);
  return 'downloaded';
}

/** Trigger a file download from a Blob, revoking the URL afterward. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download a string as a file (used for JSON / TXT exports). */
export function downloadText(text, filename, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  downloadBlob(blob, filename);
}
