/* ===========================================================================
   teleprompter.js — scrolling text overlay + reading-time estimate

   The band is a fixed window over the camera. Inside it, a "scroller" element
   is translated upward over time. We drive geometry (top/height/padding/font/
   scrim/mirror) through CSS custom properties so changes apply LIVE without
   touching MediaRecorder — safe to tweak mid-recording.
   =========================================================================== */

export class Teleprompter {
  /**
   * @param {object} els  { band, scroller, text } DOM elements
   * @param {HTMLElement} root  element on which CSS vars are set (document root)
   */
  constructor(els, root) {
    this.band = els.band;
    this.scroller = els.scroller;
    this.text = els.text;
    this.root = root || document.documentElement;

    this.offset = 0;          // px scrolled so far
    this.speed = 40;          // px/s
    this.playing = false;
    this._raf = null;
    this._lastTs = 0;
    this.onEnd = null;        // optional callback when scroll reaches the end
  }

  /* ----------------------- content + geometry ----------------------- */

  setText(text) {
    this.text.textContent = text || '';
    this.reset();
  }

  setSpeed(pxPerSec) { this.speed = pxPerSec; }

  setFont(px)      { this.root.style.setProperty('--tp-font', px + 'px'); }
  setTop(vh)       { this.root.style.setProperty('--tp-top', vh + 'vh'); }
  setHeight(vh)    { this.root.style.setProperty('--tp-height', vh + 'vh'); }
  setPad(vw)       { this.root.style.setProperty('--tp-pad', vw + 'vw'); }
  setScrim(pct)    { this.root.style.setProperty('--tp-scrim', (pct / 100).toFixed(2)); }
  setMirror(on)    { this.root.style.setProperty('--tp-mirror', on ? -1 : 1); }

  /* ----------------------- scroll loop ----------------------- */

  // Total distance the text must travel so it fully exits the top of the band:
  // text height + one band height (it starts just below the band).
  totalDistance() {
    return this.text.scrollHeight + this.band.clientHeight;
  }

  _apply() {
    // Text starts just below the band (translateY = bandHeight) and moves up.
    const y = this.band.clientHeight - this.offset;
    this.scroller.style.transform = `translateY(${y}px)`;
  }

  reset() {
    this.offset = 0;
    this._apply();
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this._lastTs = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  pause() {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  // Delta-time loop → frame-rate independent. Arrow fn to keep `this`.
  _tick = (ts) => {
    if (!this.playing) return;
    if (!this._lastTs) this._lastTs = ts;
    const dt = (ts - this._lastTs) / 1000; // seconds
    this._lastTs = ts;

    this.offset += this.speed * dt;
    const total = this.totalDistance();
    if (this.offset >= total) {
      this.offset = total;
      this._apply();
      this.pause();
      if (this.onEnd) this.onEnd();
      return;
    }
    this._apply();
    this._raf = requestAnimationFrame(this._tick);
  };

  /* ----------------------- reading-time estimate ----------------------- */

  // Seconds = totalScrollDistance / speed. Mirrors the actual scroll mechanics
  // (not a generic words-per-minute), so it stays accurate as the user changes
  // speed, font size, band height, or column width.
  estimateSeconds(speed = this.speed) {
    if (!speed) return 0;
    return this.totalDistance() / speed;
  }
}

/* Format seconds as ~m:ss */
export function formatReadTime(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '~0:00';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `~${m}:${ss}`;
}

/* ---------------------------------------------------------------------------
   Off-screen reading-time estimate for the SCRIPT screen, where the live band
   isn't mounted/visible. We reuse a hidden measurer sized to the same column
   width and font as the live band so wrapping (and thus scrollHeight) matches.
   --------------------------------------------------------------------------- */
export function estimateSecondsOffscreen(measurerEl, { text, fontPx, padVw, heightVh, speed }) {
  // Column width must mirror the live band: full width minus 2*padding.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const colWidth = Math.max(80, vw - 2 * (padVw / 100) * vw);
  const bandHeight = (heightVh / 100) * vh;

  measurerEl.style.width = colWidth + 'px';
  measurerEl.style.fontSize = fontPx + 'px';
  measurerEl.textContent = text || '';

  const total = measurerEl.scrollHeight + bandHeight;
  return speed ? total / speed : 0;
}
