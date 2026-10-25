# Marketing automation

Goal: after a one-time setup by the owner, the game brings in players by itself, with no ad
spend: content from real game events, published to the game's **own** channels through official
APIs, viral loops inside the game, organic search, and an optimiser that moves effort to what
brings players who actually race (not clicks).

**Never:** posting into other people's groups or channels, mass DMs, messages to people who did
not start the bot, fake accounts, bought views/reactions, scraping users, disguised ads. The bot
writes only to players who started it and kept notifications on. Content is real game events
only; the game is never presented as betting; personal data (Telegram names) never appears in
public content — horses by name, stables only with the owner's consent.

## Stages

| # | Stage | Status |
|---|---|---|
| 1 | Viral loops in the game + public share pages with link previews (M3) | ✅ live |
| 2 | Image cards from game events + the game's own Telegram channel (M1, M2) | planned |
| 3 | Race videos + YouTube Shorts / Instagram / Facebook / Bluesky / Threads (M1, M2) | planned |
| 4 | Public SEO site: landing, guides, results, sitemap (M4) | planned |
| 5 | Retention: first-week path, unclaimed rewards, cup closing, season end (M6) | planned |
| 6 | Attribution + bandit optimiser + weekly report to the owner (M7) | planned |
| 7 | Self-serve partner dashboard (M8) | planned |
| 8 | Marketing tab: channel health, queue, kill switches (M9) | planned |
| 9 | One-time directory submission checklist (M5) | planned |

## Stage 1 — viral loops and public share pages

**Public pages (no sign-in, any browser).**

- `/replay/?id=<race>&r=<referral code>` — a finished race: the replay starts by itself on the
  camera, the result under it, and "Play free in Telegram" (deep link `race_<id>_r<code>`, which
  credits the sharer and opens the race's replay inside the Mini App).
- `/horse-card/?id=<horse>&r=<code>` — a horse: age, sex, coat, career record, rating, earnings,
  last five runs (each a link to its public replay), and "Can your horse beat …? Play free".
- API (`@Public`, read-only, rate-limited like any read): `GET /public/races/:id` and
  `/public/races/:id/live` (finished races only — 404 before), `GET /public/horses/:id` (no
  attributes or genome; scouting stays a paid in-game feature), `POST /public/share-visits`
  (counts a view per day, page and sharer code in `share_visits`).
- Privacy: owner ids are never exposed; the owner appears only as the stable's name and only when
  the owner turned on **Profile → "Show my stable on shared pages"** (`settings.publicStable`,
  off by default). Telegram names never appear.

**Link previews.** The site is a static export, so the Cloudflare Worker (`apps/web/worker`,
`main` in `wrangler.jsonc`) runs only for `/replay/*` and `/horse-card/*`
(`assets.run_worker_first`): it fetches the race/horse from the API and writes the page's
title, description, Open Graph and Twitter tags before serving it. Any failure serves the
static page unchanged. The API address comes from `share-config.json`, written next to the site
by `apps/web/scripts/share-config.mjs` from the same `NEXT_PUBLIC_API_URL` the app is built
with. Preview images (1200×630 PNG, the game's dark-and-gold style) are drawn by the API:
`GET /public/og/race/:id` (winner, places, conditions) and `GET /public/og/horse/:id` (name,
record, rating), from SVG with resvg and the bundled OFL fonts in `apps/api/assets/fonts`
(Inter, Playfair Display). Cached in memory and by `Cache-Control` (race: a day; horse: ten
minutes).

**In the game.**

- Race page: after any of the viewer's runs, "Share result"; after a **win or a place** a gold
  prompt "Bold Ruler won! Share the replay" — at most 3 a week, once per race, "Not now" hides it
  for that race; off with **Profile → "Suggest sharing my wins"** (`settings.sharePrompts`).
- Horse page: the share button sends the horse card, worded as a challenge for one's own horse
  ("Think your horse can beat …?").
- Shares go through Telegram's share sheet with the public page's URL, so the chat shows the
  preview card.
- An invited player sees "You were invited by <stable> — run your first race and you both get
  bonus credits" on the home screen until their first race (`HomeDto.invite`); the reward itself
  is the existing referral reward with its anti-fraud rules.
- Shared race links that open the Mini App (`race_<id>…`) land on the race's replay.

**Measuring it.** Admin console → players tab → **Viral loop** (7 / 30 days): share-page visits
(and those carrying a sharer's code, from how many sharers), invited players and how many ran a
race, active players, and the K-factor = invited players who raced ÷ active players.

**Owner setup for stage 1:** none — it works after the next deploy of the API (Railway) and the
site (Cloudflare). The Docker image now also copies `apps/api/assets` (the fonts).
