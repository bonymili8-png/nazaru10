# TeleProm

A mobile-first **Progressive Web App** that turns your phone into a teleprompter
**and** video recorder. Read a scrolling script positioned near the front-camera
lens while you record, then save the clip straight to your device — perfect for
TikTok / Reels / Shorts where keeping eye contact matters.

100% client-side. No backend, no build step required. Vanilla JS + ES modules.

---

## Features

- **Camera + recording** — full-screen preview via `getUserMedia`, front/rear
  toggle, `MediaRecorder` with runtime MIME detection (MP4 on iOS, WebM/VP9 on
  Android/Chrome), red indicator + `mm:ss` timer.
- **Teleprompter overlay** — semi-transparent scrolling text over the preview,
  delta-time `requestAnimationFrame` loop (frame-rate independent), high-contrast
  white text with a dark scrim. Positioned **near the lens** so your gaze stays
  on camera.
- **Live controls** (safe to change mid-recording): scroll speed, font size,
  band vertical position / height / column width, scrim opacity, play / pause /
  reset, mirror mode (for beam-splitter rigs). **Tap-and-hold** the left/right
  screen edges to momentarily slow down / speed up the scroll (released = back
  to the slider speed).
- **Clear lock feedback** — controls that can't change mid-recording (camera
  flip, resolution, bitrate) are greyed out with a tooltip / toast explaining
  you must stop recording first.
- **Countdown** — configurable 3 / 5 / 10s (or off) before recording starts; the
  scroll begins exactly when recording does, so timing matches the video.
- **Settings** — countdown length, capture **resolution** (480/720/1080p, `ideal`
  constraints with real resolution read back from `track.getSettings()`),
  **bitrate** (hint), mirror, default speed/font/scrim, target-length warning.
  Stream-affecting settings are locked while recording.
- **Script library** — multiple scripts in `localStorage` (`teleprom.scripts`),
  load / edit / duplicate / delete, debounced autosave of in-progress drafts,
  import/export (`.json` library or single, `.txt`), de-dupe + id regeneration
  on import.
- **Reading-time estimate** — computed from the *actual* scroll mechanics
  (`scrollHeight + bandHeight) / speed`), updates live as you change speed, font,
  band height, or column width. Warns past your target length (default 90s).
- **Save** — Web Share API with files (reliable on iOS → Photos/Files), else an
  auto-clicked `<a download>` (Android → Downloads). Object URLs are always
  revoked.
- **PWA** — `manifest.json`, offline app-shell service worker, iOS standalone
  meta tags, portrait orientation, maskable icons.

---

## Run locally

Camera APIs need a **secure context**: `https://` **or** `localhost`. On desktop,
`localhost` is enough to test the flow:

```bash
# any static server works — pick one:
npx serve .
# or
npx vite
# or
python3 -m http.server 8000
```

Open the printed `http://localhost:…` URL.

### Testing on a real phone

A phone hitting your laptop over the LAN is **not** a secure context, so the
camera won't start. Use one of:

- **ngrok** — `ngrok http 8000`, then open the `https://…ngrok…` URL on your phone.
- **Deploy** the folder to **Netlify** or **Vercel** (drag-and-drop the directory,
  or connect the repo) — both serve HTTPS automatically. Since there's no build
  step, the publish directory is just the project root.

> Production note: outside `localhost`, the camera/mic and Web Share APIs require
> HTTPS. The code checks `isSecureContext` and shows a clear message otherwise.

---

## File structure

```
index.html            # screens (script / recorder / review) + overlays
css/styles.css        # all styling; teleprompter geometry via CSS variables
js/app.js             # controller: view-state machine + wiring
js/storage.js         # localStorage: settings, script library, drafts
js/teleprompter.js    # scroll loop + reading-time estimate
js/recorder.js        # getUserMedia + MediaRecorder + MIME detection
js/save.js            # Web Share / download + filenames
manifest.json         # PWA manifest
service-worker.js     # offline app-shell cache
icons/                # 192 + 512 maskable icons
```

The view-state machine is just `body[data-view="script|recorder|review"]` toggled
from `app.js`; CSS shows the matching `.view`. Settings and the countdown are
overlays that can sit on top of any view.

---

## iOS vs Android — known differences

| Area | iOS Safari | Android Chrome |
|------|-----------|----------------|
| `MediaRecorder` | Needs **iOS 14.3+**; reliably produces only **MP4/H.264** | WebM (VP9/VP8) or MP4 |
| MIME chosen | `video/mp4` | `video/webm;codecs=vp9` → `video/webm` |
| Saving | **Web Share API** → share sheet → *Save Video* into Photos/Files | `<a download>` → Downloads folder |
| `videoBitsPerSecond` | Often **ignored** (treated as a hint) | Generally honored |
| Camera start | Requires **HTTPS + a user tap**; won't auto-start | Requires HTTPS + tap |
| Preview | `playsinline` + `muted` required to avoid fullscreen takeover | Same |
| Background | Recording **pauses/stops** if you switch apps — app warns on `visibilitychange` | Same caveat |

The recording + save path is the most platform-fragile part; it's heavily
commented in `js/recorder.js` and `js/save.js`.

---

## Privacy

Everything stays on your device. Scripts live in `localStorage`; video never
leaves the browser except through the share sheet / download **you** trigger.
