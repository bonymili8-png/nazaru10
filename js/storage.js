/* ===========================================================================
   storage.js — localStorage-backed settings + script library
   =========================================================================== */

const KEYS = {
  settings: 'teleprom.settings',
  scripts: 'teleprom.scripts',
  activeId: 'teleprom.activeScriptId',
  draft: 'teleprom.draft',
};

/* ----------------------------- Settings ----------------------------- */

const DEFAULT_SETTINGS = {
  countdown: 3,            // seconds: 0 | 3 | 5 | 10
  resolution: 720,         // 480 | 720 | 1080
  bitrate: 5000000,        // bits/sec
  mirror: false,           // mirror teleprompter text (beam-splitter rig)
  mirrorPreview: true,     // mirror the front-camera PREVIEW (selfie view).
                           // Cosmetic only — the recorded file is never mirrored.
  speed: 40,               // default scroll speed px/s
  font: 32,                // default font size px
  scrim: 35,               // scrim opacity %  (0..90)
  // band geometry (percentages) — defaults put the band near the top, close
  // to the front lens so the reader's gaze stays near the camera.
  pos: 8,                  // band top (vh)
  height: 38,              // band height (vh)
  pad: 6,                  // horizontal padding (vw) — narrows the column
  targetSeconds: 90,       // reading-time warning threshold (common TikTok cap)
};

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS.settings) || '{}');
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEYS.settings, JSON.stringify(settings));
}

/* ----------------------------- Script library ----------------------------- */
// Shape: [{ id, title, text, createdAt, updatedAt }]

export function loadScripts() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEYS.scripts) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveScripts(scripts) {
  localStorage.setItem(KEYS.scripts, JSON.stringify(scripts));
}

export function getActiveId() {
  return localStorage.getItem(KEYS.activeId) || null;
}

export function setActiveId(id) {
  if (id) localStorage.setItem(KEYS.activeId, id);
  else localStorage.removeItem(KEYS.activeId);
}

/* ----------------------------- Draft autosave ----------------------------- */

export function saveDraft(draft) {
  localStorage.setItem(KEYS.draft, JSON.stringify(draft || {}));
}
export function loadDraft() {
  try { return JSON.parse(localStorage.getItem(KEYS.draft) || 'null'); }
  catch { return null; }
}
export function clearDraft() {
  localStorage.removeItem(KEYS.draft);
}

/* ----------------------------- Helpers ----------------------------- */

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older browsers that lack randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Derive a title from the first non-empty line of the text.
export function deriveTitle(text) {
  const line = (text || '').split('\n').map(s => s.trim()).find(Boolean);
  if (!line) return 'Untitled';
  return line.length > 60 ? line.slice(0, 57) + '…' : line;
}

export function firstLine(text) {
  return (text || '').split('\n').map(s => s.trim()).find(Boolean) || '';
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
