/* ===========================================================================
   app.js — TeleProm main controller

   - View-state machine: 'script' | 'recorder' | 'review' (body[data-view]).
     Settings + countdown are overlays on top of any view.
   - Wires the script library, settings, teleprompter, camera/recorder, save.
   =========================================================================== */

import {
  loadSettings, saveSettings,
  loadScripts, saveScripts, getActiveId, setActiveId,
  saveDraft, loadDraft, clearDraft,
  uuid, deriveTitle, firstLine, formatDate,
} from './storage.js';
import { Teleprompter, formatReadTime, estimateSecondsOffscreen } from './teleprompter.js';
import { Recorder, extensionForMime } from './recorder.js';
import { saveVideo, downloadText, makeFilename } from './save.js';

/* ----------------------------- tiny DOM helpers ----------------------------- */
const $ = (id) => document.getElementById(id);
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

/* ----------------------------- app state ----------------------------- */
const state = {
  view: 'script',
  settings: loadSettings(),
  scripts: loadScripts(),
  editingId: null,        // id of script open in editor (null = new)
  recordBlob: null,
  recordUrl: null,        // object URL for the review <video>
  recordMime: '',
  recordExt: '',
};

const recorder = new Recorder();
let tp;                   // Teleprompter instance (created on DOMContentLoaded)
let timerInterval = null;
let recordStartMs = 0;

/* ===========================================================================
   View switching
   =========================================================================== */
function setView(view) {
  state.view = view;
  document.body.setAttribute('data-view', view);
}

/* ===========================================================================
   Toast
   =========================================================================== */
let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

/* ===========================================================================
   Settings — load into UI, persist, apply
   =========================================================================== */
function applySettingsToTeleprompter() {
  const s = state.settings;
  tp.setFont(s.font);
  tp.setTop(s.pos);
  tp.setHeight(s.height);
  tp.setPad(s.pad);
  tp.setScrim(s.scrim);
  tp.setMirror(s.mirror);
  tp.setSpeed(s.speed);
}

function persistSettings() {
  saveSettings(state.settings);
}

function syncSettingsUI() {
  const s = state.settings;
  $('set-countdown').value = String(s.countdown);
  $('set-resolution').value = String(s.resolution);
  $('set-bitrate').value = String(s.bitrate);
  $('set-mirror').checked = s.mirror;
  $('set-mirror-preview').checked = s.mirrorPreview;
  $('set-speed').value = s.speed;       $('set-speed-val').textContent = s.speed;
  $('set-font').value = s.font;         $('set-font-val').textContent = s.font;
  $('set-scrim').value = s.scrim;       $('set-scrim-val').textContent = s.scrim;
  $('set-target').value = s.targetSeconds; $('set-target-val').textContent = s.targetSeconds;
}

// Sync the live recorder-screen controls from settings (speed/font/etc.).
function syncRecorderControlsUI() {
  const s = state.settings;
  $('speed-range').value = s.speed;  $('speed-val').textContent = `${s.speed} px/s`;
  $('font-range').value = s.font;    $('font-val').textContent = `${s.font} px`;
  $('pos-range').value = s.pos;
  $('height-range').value = s.height;
  $('pad-range').value = s.pad;
  $('scrim-range').value = s.scrim;
}

function openSettings() {
  syncSettingsUI();
  // Resolution/bitrate cannot change mid-recording — disable + explain.
  const recording = recorder.isRecording();
  $('set-resolution').disabled = recording;
  $('set-bitrate').disabled = recording;
  const lockTip = recording ? 'Stop recording to change this' : '';
  $('set-resolution').title = lockTip;
  $('set-bitrate').title = lockTip;
  $('res-lock-note').textContent = recording ? '(locked while recording)' : '';
  $('settings').classList.remove('hidden');
}
function closeSettings() { $('settings').classList.add('hidden'); }

function wireSettings() {
  on($('btn-open-settings'), 'click', openSettings);
  on($('btn-rec-settings'), 'click', openSettings);
  on($('btn-close-settings'), 'click', closeSettings);
  on($('settings'), 'click', (e) => { if (e.target.id === 'settings') closeSettings(); });

  on($('set-countdown'), 'change', (e) => { state.settings.countdown = +e.target.value; persistSettings(); });

  // Resolution change → restart the stream cleanly (if we have one).
  on($('set-resolution'), 'change', async (e) => {
    state.settings.resolution = +e.target.value;
    persistSettings();
    if (recorder.stream && !recorder.isRecording()) {
      try {
        await recorder.start({ facingMode: recorder.facingMode, resolution: state.settings.resolution });
        $('preview').srcObject = recorder.stream;
        updateResReadout();
      } catch (err) { showCamError(err); }
    }
  });

  on($('set-bitrate'), 'change', (e) => { state.settings.bitrate = +e.target.value; persistSettings(); });
  on($('set-mirror'), 'change', (e) => { state.settings.mirror = e.target.checked; tp.setMirror(e.target.checked); persistSettings(); });
  on($('set-mirror-preview'), 'change', (e) => { state.settings.mirrorPreview = e.target.checked; applyPreviewMirror(); persistSettings(); });

  on($('set-speed'), 'input', (e) => {
    state.settings.speed = +e.target.value; $('set-speed-val').textContent = e.target.value;
    tp.setSpeed(state.settings.speed); syncRecorderControlsUI(); updateRecReadingReadout(); persistSettings();
  });
  on($('set-font'), 'input', (e) => {
    state.settings.font = +e.target.value; $('set-font-val').textContent = e.target.value;
    tp.setFont(state.settings.font); syncRecorderControlsUI(); updateRecReadingReadout(); persistSettings();
  });
  on($('set-scrim'), 'input', (e) => {
    state.settings.scrim = +e.target.value; $('set-scrim-val').textContent = e.target.value;
    tp.setScrim(state.settings.scrim); syncRecorderControlsUI(); persistSettings();
  });
  on($('set-target'), 'input', (e) => {
    state.settings.targetSeconds = +e.target.value; $('set-target-val').textContent = e.target.value;
    persistSettings(); renderEditorReading(); updateRecReadingReadout();
  });
}

/* ===========================================================================
   Script library — list rendering + actions
   =========================================================================== */
function showLibrary() {
  $('library-panel').classList.remove('hidden');
  $('editor-panel').classList.add('hidden');
  renderScriptList();
}
function showEditor() {
  $('library-panel').classList.add('hidden');
  $('editor-panel').classList.remove('hidden');
}

function renderScriptList() {
  const list = $('script-list');
  const empty = $('empty-state');
  list.innerHTML = '';

  if (!state.scripts.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const activeId = getActiveId();
  // Most-recently-updated first.
  const sorted = [...state.scripts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  for (const sc of sorted) {
    const li = document.createElement('li');
    li.className = 'script-item' + (sc.id === activeId ? ' active' : '');
    li.innerHTML = `
      <div class="si-title"></div>
      <div class="si-preview"></div>
      <div class="si-meta"><span class="si-date"></span><span class="si-len"></span></div>
      <div class="si-actions">
        <button class="btn primary small" data-act="load"><svg class="ic"><use href="#i-video"/></svg> Load</button>
        <button class="btn ghost small" data-act="edit"><svg class="ic"><use href="#i-edit"/></svg> Edit</button>
        <button class="btn ghost small" data-act="dup"><svg class="ic"><use href="#i-copy"/></svg></button>
        <button class="btn ghost small danger" data-act="del"><svg class="ic"><use href="#i-trash"/></svg></button>
      </div>`;
    li.querySelector('.si-title').textContent = sc.title || deriveTitle(sc.text);
    li.querySelector('.si-preview').textContent = firstLine(sc.text) || '(empty)';
    li.querySelector('.si-date').textContent = 'Edited ' + formatDate(sc.updatedAt || sc.createdAt);
    li.querySelector('.si-len').textContent = `${(sc.text || '').length} chars`;

    li.querySelector('[data-act="load"]').onclick = () => loadScriptToRecorder(sc.id);
    li.querySelector('[data-act="edit"]').onclick = () => openEditor(sc.id);
    li.querySelector('[data-act="dup"]').onclick = () => duplicateScript(sc.id);
    li.querySelector('[data-act="del"]').onclick = () => deleteScript(sc.id);
    list.appendChild(li);
  }
}

function getScript(id) { return state.scripts.find(s => s.id === id); }

function openEditor(id) {
  state.editingId = id || null;
  const sc = id ? getScript(id) : null;
  $('editor-title').textContent = sc ? 'Edit script' : 'New script';
  $('script-title').value = sc ? (sc.title || '') : '';
  $('script-text').value = sc ? (sc.text || '') : '';
  // Restore in-progress draft only for a brand-new (unsaved) script.
  if (!sc) {
    const draft = loadDraft();
    if (draft && (draft.title || draft.text)) {
      $('script-title').value = draft.title || '';
      $('script-text').value = draft.text || '';
    }
  }
  renderEditorReading();
  showEditor();
}

// Returns the saved script id.
function saveEditor() {
  const title = $('script-title').value.trim();
  const text = $('script-text').value;
  const now = Date.now();
  let sc = state.editingId ? getScript(state.editingId) : null;

  const finalTitle = title || deriveTitle(text);

  if (sc) {
    sc.title = finalTitle;
    sc.text = text;
    sc.updatedAt = now;
  } else {
    sc = { id: uuid(), title: finalTitle, text, createdAt: now, updatedAt: now };
    state.scripts.push(sc);
    state.editingId = sc.id;
  }
  saveScripts(state.scripts);
  clearDraft();
  return sc.id;
}

function duplicateScript(id) {
  const sc = getScript(id);
  if (!sc) return;
  const now = Date.now();
  const copy = { id: uuid(), title: (sc.title || deriveTitle(sc.text)) + ' (copy)', text: sc.text, createdAt: now, updatedAt: now };
  state.scripts.push(copy);
  saveScripts(state.scripts);
  renderScriptList();
  toast('Duplicated');
}

function deleteScript(id) {
  const sc = getScript(id);
  if (!sc) return;
  if (!confirm(`Delete "${sc.title || deriveTitle(sc.text)}"? This cannot be undone.`)) return;
  state.scripts = state.scripts.filter(s => s.id !== id);
  saveScripts(state.scripts);
  // Deleting the active script → clear active + fall back to empty state.
  if (getActiveId() === id) setActiveId(null);
  renderScriptList();
  toast('Deleted');
}

function loadScriptToRecorder(id) {
  const sc = getScript(id);
  if (!sc) return;
  setActiveId(id);
  tp.setText(sc.text);
  enterRecorder();
}

/* ===========================================================================
   Editor: reading-time + debounced autosave
   =========================================================================== */
function renderEditorReading() {
  const s = state.settings;
  const seconds = estimateSecondsOffscreen($('measurer'), {
    text: $('script-text').value,
    fontPx: s.font, padVw: s.pad, heightVh: s.height, speed: s.speed,
  });
  const el = $('editor-reading');
  el.innerHTML = `Estimated read: <strong>${formatReadTime(seconds)}</strong> at ${s.speed} px/s`;
  el.classList.toggle('over', seconds > s.targetSeconds);
}

let draftTimer = null;
function scheduleAutosave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    // Only autosave drafts for brand-new (unsaved) scripts to avoid clobbering.
    if (!state.editingId) {
      saveDraft({ title: $('script-title').value, text: $('script-text').value });
    }
  }, 500);
}

/* ===========================================================================
   Import / Export
   =========================================================================== */
function exportAll() {
  if (!state.scripts.length) { toast('Nothing to export', true); return; }
  downloadText(JSON.stringify(state.scripts, null, 2), makeFilename('json', 'teleprom-scripts'));
}

function exportSingle(format) {
  const id = state.editingId;
  const sc = id ? getScript(id) : null;
  // If editing an unsaved script, export the current textarea contents.
  const title = $('script-title').value.trim() || deriveTitle($('script-text').value);
  const text = $('script-text').value;
  const safeName = (title || 'script').replace(/[^\w\-]+/g, '_').slice(0, 40) || 'script';

  if (format === 'txt') {
    downloadText(text, `${safeName}.txt`, 'text/plain');
  } else {
    const obj = sc
      ? sc
      : { id: uuid(), title, text, createdAt: Date.now(), updatedAt: Date.now() };
    downloadText(JSON.stringify(obj, null, 2), `${safeName}.json`);
  }
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const content = String(reader.result || '');
    const isJson = /\.json$/i.test(file.name) || file.type === 'application/json';
    try {
      if (isJson) importJson(content);
      else importTxt(content, file.name);
    } catch (err) {
      toast('Could not import: ' + (err.message || 'invalid file'), true);
    }
  };
  reader.onerror = () => toast('Could not read file', true);
  reader.readAsText(file);
}

function importJson(content) {
  let data;
  try { data = JSON.parse(content); }
  catch { throw new Error('not valid JSON'); }

  // Accept either an array of scripts or a single script object.
  const incoming = Array.isArray(data) ? data : [data];
  const existingTexts = new Set(state.scripts.map(s => (s.text || '').trim()));
  let imported = 0, skipped = 0;

  for (const item of incoming) {
    if (!item || typeof item.text !== 'string') { skipped++; continue; }
    const text = item.text;
    if (existingTexts.has(text.trim())) { skipped++; continue; } // skip exact dup
    const now = Date.now();
    state.scripts.push({
      id: uuid(),                                   // regenerate id to avoid collisions
      title: (item.title && String(item.title)) || deriveTitle(text),
      text,
      createdAt: item.createdAt || now,
      updatedAt: now,
    });
    existingTexts.add(text.trim());
    imported++;
  }
  if (!imported && !skipped) throw new Error('no scripts found');
  saveScripts(state.scripts);
  renderScriptList();
  toast(`Imported ${imported} script${imported === 1 ? '' : 's'}` + (skipped ? `, skipped ${skipped}` : ''));
}

function importTxt(content, filename) {
  const now = Date.now();
  const title = filename.replace(/\.[^.]+$/, '') || deriveTitle(content);
  state.scripts.push({ id: uuid(), title, text: content, createdAt: now, updatedAt: now });
  saveScripts(state.scripts);
  renderScriptList();
  toast('Imported 1 script');
}

/* ===========================================================================
   Recorder screen
   =========================================================================== */
function showCamError(err) {
  const el = $('cam-error');
  let msg = err && err.message ? err.message : 'Could not access the camera.';
  if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
    msg = 'Camera & microphone access was denied. Enable it in your browser settings and tap Record again.';
  } else if (err && err.name === 'NotFoundError') {
    msg = 'No camera found on this device.';
  }
  el.textContent = msg + ' Tap to dismiss.';
  el.classList.remove('hidden');
  el.onclick = () => el.classList.add('hidden');
}

async function enterRecorder() {
  setView('recorder');
  syncRecorderControlsUI();
  applySettingsToTeleprompter();
  tp.reset();
  updateRecReadingReadout();
  setRecordingLocks(false);

  // Start the camera. This is invoked from a user tap (Load / Record again),
  // satisfying iOS's user-gesture requirement for getUserMedia.
  try {
    await recorder.start({ facingMode: recorder.facingMode, resolution: state.settings.resolution });
    $('preview').srcObject = recorder.stream;
    applyPreviewMirror();
    updateResReadout();
    $('cam-error').classList.add('hidden');
  } catch (err) {
    showCamError(err);
  }
}

// Mirror the *preview* for the front camera (selfie view). This is purely
// cosmetic — the recorded video is NEVER mirrored (the transform lives on the
// <video> element, not the stream). Rear camera is always shown un-mirrored.
// Controlled by the "Mirror front-camera preview" setting.
function applyPreviewMirror() {
  const mirror = recorder.facingMode === 'user' && state.settings.mirrorPreview;
  $('preview').style.transform = mirror ? 'scaleX(-1)' : 'scaleX(1)';
}

function updateResReadout() {
  const r = recorder.actualResolution;
  $('res-readout').textContent = r ? `${r.width}×${r.height}` : '—';
}

function updateRecReadingReadout() {
  if (state.view !== 'recorder') return;
  const seconds = tp.estimateSeconds(state.settings.speed);
  const el = $('rec-reading');
  el.textContent = formatReadTime(seconds);
  el.style.color = seconds > state.settings.targetSeconds ? 'var(--warn)' : '';
}

// Disable controls that can't change mid-recording (facing, resolution,
// bitrate). Live controls (speed/font/position/scrim) stay enabled.
// The flip button is greyed via `.locked` (not `disabled`) so a tap still
// fires and we can explain *why* it's unavailable.
function setRecordingLocks(recording) {
  $('btn-flip').classList.toggle('locked', recording);
  $('btn-flip').title = recording ? 'Stop recording to switch camera' : 'Switch camera';
}

async function flipCamera() {
  if (recorder.isRecording()) { toast('Stop recording to switch camera.'); return; }
  const next = recorder.facingMode === 'user' ? 'environment' : 'user';
  try {
    await recorder.start({ facingMode: next, resolution: state.settings.resolution });
    $('preview').srcObject = recorder.stream;
    applyPreviewMirror();
    updateResReadout();
  } catch (err) { showCamError(err); }
}

/* ----------------------------- Countdown + record ----------------------------- */
function runCountdown(seconds) {
  return new Promise((resolve) => {
    if (!seconds) return resolve();
    const overlay = $('countdown');
    const num = $('countdown-num');
    overlay.classList.remove('hidden');
    let n = seconds;

    const tick = () => {
      num.textContent = n;
      // Re-trigger the CSS fade/scale animation each tick.
      num.classList.remove('tick');
      void num.offsetWidth; // reflow
      num.classList.add('tick');
      n--;
      if (n < 0) {
        clearInterval(iv);
        overlay.classList.add('hidden');
        resolve();
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
  });
}

async function onRecordTap() {
  if (recorder.isRecording()) {
    await stopRecording();
    return;
  }
  if (!recorder.stream) {
    // Camera not started yet (e.g. permission was denied) — try again.
    await enterRecorder();
    if (!recorder.stream) return;
  }

  // Countdown first, with the preview still visible behind it.
  await runCountdown(state.settings.countdown);

  try {
    const mime = recorder.startRecording({ bitrate: state.settings.bitrate });
    state.recordMime = mime;
    state.recordExt = extensionForMime(mime);
  } catch (err) {
    showCamError(err);
    return;
  }

  // Start the teleprompter scroll at the SAME moment recording begins, so the
  // on-screen script timing matches the captured video.
  tp.reset();
  tp.play();
  syncPlayBtn();

  // UI: red dot + timer + button morph + lock non-live controls.
  $('btn-record').classList.add('recording');
  $('rec-dot').classList.remove('hidden');
  setRecordingLocks(true);
  startTimer();
}

async function stopRecording() {
  stopTimer();
  tp.pause();
  syncPlayBtn();
  $('btn-record').classList.remove('recording');
  $('rec-dot').classList.add('hidden');
  setRecordingLocks(false);
  $('bg-warn').classList.add('hidden');

  let blob;
  try {
    blob = await recorder.stopRecording();
  } catch (err) {
    toast('Recording failed: ' + (err.message || ''), true);
    return;
  }
  enterReview(blob);
}

function startTimer() {
  recordStartMs = Date.now();
  $('rec-timer').textContent = '00:00';
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordStartMs) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    $('rec-timer').textContent = `${m}:${s}`;
  }, 250);
}
function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

/* ===========================================================================
   Review screen
   =========================================================================== */
function enterReview(blob) {
  // Release any previous review URL first.
  if (state.recordUrl) { URL.revokeObjectURL(state.recordUrl); state.recordUrl = null; }
  state.recordBlob = blob;
  state.recordUrl = URL.createObjectURL(blob);

  const v = $('review-video');
  v.src = state.recordUrl;

  const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
  $('review-meta').textContent = `${state.recordExt.toUpperCase()} · ${sizeMb} MB · ${state.recordMime || 'unknown type'}`;
  setView('review');
}

async function onSaveTap() {
  if (!state.recordBlob) return;
  const filename = makeFilename(state.recordExt || 'webm');
  try {
    const how = await saveVideo(state.recordBlob, filename, state.recordMime);
    if (how === 'shared') toast('Shared — choose “Save Video”.');
    else if (how === 'downloaded') toast('Saved to your downloads.');
    else if (how === 'cancelled') toast('Save cancelled.');
  } catch (err) {
    toast('Could not save: ' + (err.message || ''), true);
  }
}

function recordAgain() {
  // Clean up the review video + object URL before going back.
  const v = $('review-video');
  v.pause();
  v.removeAttribute('src');
  v.load();
  if (state.recordUrl) { URL.revokeObjectURL(state.recordUrl); state.recordUrl = null; }
  state.recordBlob = null;
  enterRecorder();
}

function leaveRecorder() {
  // Going back to the library: stop the camera to release it.
  if (recorder.isRecording()) return; // ignore while recording
  recorder.stop();
  $('preview').srcObject = null;
  setView('script');
  showLibrary();
}

/* ===========================================================================
   Visibility — no background recording (warn the user)
   =========================================================================== */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && recorder.isRecording()) {
    // We can't keep recording reliably in the background; surface a warning.
    $('bg-warn').classList.remove('hidden');
  }
});

/* ===========================================================================
   Wiring (DOM ready)
   =========================================================================== */
function wireLiveControls() {
  // Speed (live, mid-recording safe)
  on($('speed-range'), 'input', (e) => {
    state.settings.speed = +e.target.value;
    $('speed-val').textContent = `${e.target.value} px/s`;
    tp.setSpeed(state.settings.speed);
    updateRecReadingReadout();
    persistSettings();
  });
  // Font size (live)
  on($('font-range'), 'input', (e) => {
    state.settings.font = +e.target.value;
    $('font-val').textContent = `${e.target.value} px`;
    tp.setFont(state.settings.font);
    updateRecReadingReadout();
    persistSettings();
  });
  // Band vertical position (live)
  on($('pos-range'), 'input', (e) => { state.settings.pos = +e.target.value; tp.setTop(state.settings.pos); persistSettings(); });
  // Band height (live) — affects total scroll distance → reading time
  on($('height-range'), 'input', (e) => { state.settings.height = +e.target.value; tp.setHeight(state.settings.height); updateRecReadingReadout(); persistSettings(); });
  // Column padding / width (live) — affects wrapping → reading time
  on($('pad-range'), 'input', (e) => { state.settings.pad = +e.target.value; tp.setPad(state.settings.pad); updateRecReadingReadout(); persistSettings(); });
  // Scrim opacity (live)
  on($('scrim-range'), 'input', (e) => { state.settings.scrim = +e.target.value; tp.setScrim(state.settings.scrim); persistSettings(); });

  on($('btn-tp-play'), 'click', () => { tp.toggle(); syncPlayBtn(); });
  on($('btn-tp-reset'), 'click', () => { tp.reset(); });
  // Keep the play/pause icon in sync if the scroll auto-stops at the end.
  tp.onEnd = () => { syncPlayBtn(); };
}

// Toggle the play/pause icon (CSS swaps the SVG based on .is-playing).
function syncPlayBtn() {
  $('btn-tp-play').classList.toggle('is-playing', tp.playing);
}

// Tap-and-hold edge zones: while held, apply a temporary scroll speed.
// On release, restore the slider/persisted speed — we never write the temp
// value to settings, so this is purely a momentary nudge.
function wireEdgeZones() {
  const bind = (el, speedFn) => {
    if (!el) return;
    let active = false;
    const start = (e) => {
      e.preventDefault();
      active = true;
      el.classList.add('active');
      tp.setSpeed(speedFn(state.settings.speed));
    };
    const end = () => {
      if (!active) return;
      active = false;
      el.classList.remove('active');
      tp.setSpeed(state.settings.speed); // restore
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
  };
  bind($('zone-left'),  (s) => Math.max(5, Math.round(s * 0.35)));    // slow down
  bind($('zone-right'), (s) => Math.min(300, Math.round(s * 2.2)));   // speed up
}

function wireButtons() {
  // Library actions
  on($('btn-new-script'), 'click', () => { clearDraft(); openEditor(null); });
  on($('btn-empty-new'), 'click', () => { clearDraft(); openEditor(null); });
  on($('btn-import'), 'click', () => $('import-file').click());
  on($('btn-empty-import'), 'click', () => $('import-file').click());
  on($('import-file'), 'change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleImportFile(f);
    e.target.value = ''; // allow re-importing the same file
  });
  on($('btn-export-all'), 'click', exportAll);

  // Editor actions
  on($('btn-editor-back'), 'click', showLibrary);
  on($('script-text'), 'input', () => { renderEditorReading(); scheduleAutosave(); });
  on($('script-title'), 'input', scheduleAutosave);
  on($('btn-save-script'), 'click', () => { saveEditor(); toast('Saved'); showLibrary(); });
  on($('btn-save-start'), 'click', () => {
    const id = saveEditor();
    loadScriptToRecorder(id);
  });
  on($('btn-export-single-json'), 'click', () => exportSingle('json'));
  on($('btn-export-single-txt'), 'click', () => exportSingle('txt'));

  // Recorder actions
  on($('btn-record'), 'click', onRecordTap);
  on($('btn-flip'), 'click', flipCamera);
  on($('btn-rec-back'), 'click', leaveRecorder);

  // Review actions
  on($('btn-save'), 'click', onSaveTap);
  on($('btn-record-again'), 'click', recordAgain);
}

/* ===========================================================================
   Service worker registration (offline app shell)
   =========================================================================== */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
}

/* ===========================================================================
   Init
   =========================================================================== */
function init() {
  tp = new Teleprompter(
    { band: $('tp-band'), scroller: $('tp-scroller'), text: $('tp-text') },
    document.documentElement,
  );

  applySettingsToTeleprompter();
  syncSettingsUI();
  syncRecorderControlsUI();

  wireButtons();
  wireLiveControls();
  wireEdgeZones();
  wireSettings();

  // Start on the script library.
  setView('script');
  showLibrary();

  registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', init);
