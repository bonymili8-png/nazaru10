/* ===========================================================================
   recorder.js — camera (getUserMedia) + MediaRecorder

   NOTE on platforms (handled explicitly below):
   - Camera APIs require a SECURE context: HTTPS in production, or localhost.
   - iOS Safari needs 14.3+ for MediaRecorder, and reliably produces only
     MP4/H.264. getUserMedia must be triggered by a user gesture (a tap).
   - videoBitsPerSecond is a *hint*; some browsers (esp. iOS Safari) ignore it.
   =========================================================================== */

// Map our resolution setting to ideal getUserMedia constraints. We use `ideal`
// (not `exact`) so devices that can't deliver the requested size fall back
// gracefully instead of throwing OverconstrainedError.
const RES_CONSTRAINTS = {
  480:  { width: { ideal: 854 },  height: { ideal: 480 } },
  720:  { width: { ideal: 1280 }, height: { ideal: 720 } },
  1080: { width: { ideal: 1920 }, height: { ideal: 1080 } },
};

// Pick the best supported recording MIME type at runtime.
// Prefer MP4 (iOS/Safari), then WebM/VP9, then plain WebM (Android/Chrome).
export function pickMimeType() {
  const candidates = [
    'video/mp4',
    'video/mp4;codecs=h264',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return ''; // let the browser choose a default
  }
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function extensionForMime(mime) {
  return /mp4/i.test(mime) ? 'mp4' : 'webm';
}

export class Recorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.mimeType = '';
    this.facingMode = 'user';     // default to the front camera
    this.actualResolution = null; // { width, height } from track.getSettings()
  }

  isSecureContext() {
    return window.isSecureContext ||
      ['localhost', '127.0.0.1'].includes(location.hostname);
  }

  /**
   * Start (or restart) the camera stream.
   * Must be called from a user gesture on iOS. Throws on permission denial /
   * unsupported context — caller shows a friendly message.
   */
  async start({ facingMode = this.facingMode, resolution = 720 } = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera API not available in this browser.');
    }
    if (!this.isSecureContext()) {
      throw new Error('Camera requires HTTPS (or localhost). Open this page over a secure connection.');
    }

    this.stop(); // release any previous stream before re-acquiring

    this.facingMode = facingMode;
    const constraints = {
      audio: true,
      video: {
        facingMode: { ideal: facingMode },
        ...(RES_CONSTRAINTS[resolution] || RES_CONSTRAINTS[720]),
      },
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    // Read what the device ACTUALLY gave us — it may ignore the request.
    const track = this.stream.getVideoTracks()[0];
    const s = track ? track.getSettings() : {};
    this.actualResolution = (s.width && s.height) ? { width: s.width, height: s.height } : null;

    return this.stream;
  }

  /** Stop all tracks and release the camera/mic. */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  /** Begin recording the current stream. Returns the chosen mimeType. */
  startRecording({ bitrate = 5000000 } = {}) {
    if (!this.stream) throw new Error('No camera stream to record.');
    this.chunks = [];
    this.mimeType = pickMimeType();

    const options = {};
    if (this.mimeType) options.mimeType = this.mimeType;
    // Hint only — may be ignored by the browser (notably iOS Safari).
    if (bitrate) options.videoBitsPerSecond = bitrate;

    try {
      this.recorder = new MediaRecorder(this.stream, options);
    } catch {
      // Some browsers reject the options object; retry with no options.
      this.recorder = new MediaRecorder(this.stream);
      this.mimeType = this.recorder.mimeType || '';
    }

    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    // Timeslice so chunks flush periodically (more robust if the tab is killed).
    this.recorder.start(1000);
    // The effective mimeType the recorder settled on.
    this.mimeType = this.recorder.mimeType || this.mimeType;
    return this.mimeType;
  }

  /** Stop recording and resolve with the assembled Blob. */
  stopRecording() {
    return new Promise((resolve, reject) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        return reject(new Error('Not recording.'));
      }
      this.recorder.onstop = () => {
        const type = this.mimeType || (this.chunks[0] && this.chunks[0].type) || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        resolve(blob);
      };
      this.recorder.onerror = (e) => reject(e.error || new Error('Recording error.'));
      this.recorder.stop();
    });
  }

  isRecording() {
    return this.recorder && this.recorder.state === 'recording';
  }
}
