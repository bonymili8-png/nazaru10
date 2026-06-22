# Hairport Barbering — PWA Website

A fast, modern, mobile-first **Progressive Web App** for Hairport Barbering
(Bushey Heath, Hertfordshire). Built with plain HTML, CSS and JavaScript — no
build step, no framework, no dependencies. It loads instantly and works offline.

## Features

- 📱 **Mobile-first & fully responsive** (375 / 768 / 1024 / 1440px)
- ⚡ **Fast** — self-contained, no external image requests, no JS framework
- 🎬 **Animations** — scroll reveals, animated barber pole, number counters,
  marquee, sticky book bar, smooth scrolling (all respect `prefers-reduced-motion`)
- 🌙 **Dark premium aesthetic** with gold accents
- 📲 **Installable PWA** — manifest + service worker + offline page
- ♿ **Accessible** — keyboard nav, focus states, skip link, ARIA labels, WCAG-AA contrast
- 🗺️ Sections: Hero · Services & pricing · About · Gallery · Reviews · Visit (hours + map) · Booking form

## ✏️ Configure your shop details

Open **`app.js`** and edit the `CONFIG` object at the top:

```js
const CONFIG = {
  phone:     "+44 20 0000 0000",  // displayed phone
  phoneTel:  "+442000000000",     // tel: link (digits + country code)
  whatsapp:  "442000000000",      // WhatsApp number (digits only, no +)
  mapsUrl:   "https://maps.app.goo.gl/xR8uXkm8Qkkx2niM9",
  bookingUrl: "",                 // optional: Booksy/Fresha link. If set, all
                                  // "Book" buttons + the form go there instead.
  hours: [ /* Sun..Sat, [open,close] or null for closed */ ],
};
```

> The placeholder phone/WhatsApp numbers **must be replaced** with the real ones.
> Until then, the booking form opens WhatsApp to the placeholder number.

Other things you may want to update:
- **Address** — `index.html`, the "Visit the shop" block.
- **Prices / services** — the `.service-card` blocks in `index.html` and the
  `<select>` options in the booking form.
- **Reviews** — the `.review-card` blocks.
- **Social links** — the footer `aria-label="Instagram"` / `Facebook` anchors.

## Run locally

A service worker requires `http://`, not `file://`. Serve the folder:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Deploy

Any static host works (it's just files):

- **GitHub Pages** — push and enable Pages on the branch root.
- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop or connect the repo.

No build command is needed — the publish directory is the project root.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup |
| `styles.css` | All styling + responsive + animations |
| `app.js` | Config, interactions, animations, form, PWA registration |
| `sw.js` | Service worker (offline caching) |
| `manifest.webmanifest` | PWA manifest |
| `offline.html` | Offline fallback page |
| `icons/` | App icons (SVG + generated PNGs) |
