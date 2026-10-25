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
| 2 | Image cards from game events + the game's own Telegram channel (M1, M2) | ✅ live |
| 3 | Race videos + YouTube Shorts / Instagram / Facebook / Bluesky / Threads (M1, M2) | ✅ built — each network posts once its account is connected |
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

## Stage 2 — the game's own Telegram channel

**What gets posted** (English only, real game events only, `apps/api/src/modules/marketing`):

| Kind | When | Card | Campaign |
|---|---|---|---|
| Race of the day | once a day from 15:00 UTC: the most watchable finished race of the last 24 h with at least 4 runners and a player's horse — close finish (margin in racing words: nose, head, neck…), upset (winner low in the pre-race ability order: "rated only 6th of 8"), a player's horse winning, a tournament final | race card | `TGCHDAY` |
| Tournament champion | each cup completed in the last 48 h | its final's race card | `TGCHCHAMP` |
| First win | one a day: the latest player's horse to win for the first time | race card | `TGCHFIRST` |
| Top of the week | Mondays from 09:00 UTC: the five highest-rated horses in training | ranked list card | `TGCHWEEK` |

Detectors run every 30 s and queue one `content_items` row per event (unique key, so re-runs
add nothing); items expire (12–24 h) rather than going out stale. The publisher posts the
highest-priority queued item (champion > top of the week > race of the day > first win) when
all of these hold: marketing and the channel switched on, the kind switched on, not paused,
inside the window (08:00–21:00 UTC), under the daily limit (3) and at least 3 h after the last
post. Each post is a photo (the card PNG, uploaded) with an HTML caption and URL buttons:
**▶️ Watch the replay** → `WEBAPP_URL/replay/?id=<race>&c=<code>` (the public page counts the
visit as a campaign click; its "Play free" opens the race with the campaign: start parameter
`race_<id>_c<code>`), and **🏇 Play free** → `t.me/<bot>/<app>?startapp=race_<id>_c<code>`
(`c_<code>` for the weekly list). The four campaigns are created automatically (no human
author) and appear in the campaigns tab with their funnel.

**Privacy:** horse names only; a stable's name appears only if its owner turned on "Show my
stable on shared pages"; never Telegram names. House horses are labelled "house yard".

**Safety and operations** (admin console → **marketing**, roles CONTENT_ADMIN / ECONOMY_ADMIN):
whether the bot can post to the channel (getMe → getChat → getChatMember: admin with posting
rights), kill switches for everything, the channel and each kind (config versions, audited as
`MARKETING_SWITCH`), the channel handle (checked with Telegram before it is saved; audited as
`MARKETING_SETTING`), the queue with card previews and "Don't post", recent posts with links to
them in the channel, "Find new posts" and "Publish next now" (skips the window and the gap,
never the switches or the daily limit). A post is tried 3 times; after 3 failures in a row the
channel pauses itself (`marketing_channels`) and every SUPER/CONTENT/ECONOMY admin gets one bot
message; "Resume posting" in the console restarts it. Limits and the window are config
(`marketing.telegram.*`).

**Owner setup for stage 2 (once):**

1. A public Telegram channel for the game, with the bot as an admin allowed to post. The
   default handle is `@horoughline_racing` (as given); fix it in the console if it differs.
2. On the API (Railway): `WEBAPP_URL` (the Mini App's address, for the replay button) and
   ideally `TELEGRAM_BOT_USERNAME` / `TELEGRAM_APP_SHORT_NAME` (otherwise the bot's username is
   read from Telegram and the app's short name defaults to `play`).
3. Check the marketing tab: "bot can post". The first post goes out at the next opening of the
   window once there is an event; "Publish next now" posts at once.

## Stage 3 — race videos and the game's own accounts on other networks

**The video.** For every queued post about a race (race of the day, tournament champion, first
win) the API draws a vertical 720×1280 MP4 of about 30 s from the race's recorded frames
(`apps/api/src/modules/marketing/video.ts`): the side-on camera that follows the leader, as in
the game, with the field's silks and saddle-cloth numbers; the running order with the gaps in
lengths; the distance to go; the early part fast-forwarded (shown as "7× SPEED") so the run-up
takes about 15 s, the last furlong in real time ("LIVE SPEED"); then the result card (winner,
the margin in racing words, 2nd and 3rd, "PLAY FREE IN TELEGRAM", the bot's @username, "no
betting"). Every frame is an SVG rasterised with the bundled fonts on libuv's thread pool and
piped into ffmpeg (H.264 + a silent AAC track, faststart); about 10 s of CPU per video. Videos
and JPEG cards are kept in `content_media` for a week and served publicly at
`/public/media/<id>.mp4|jpg` (Instagram, Facebook and Threads fetch media from a URL; byte ranges
supported). The team can watch any post's video from the queue ("Video"). The API's Docker image
installs ffmpeg.

**Where it goes** (`social.service.ts`, `social-api.ts`, official APIs only, the owner's own
accounts):

| Network | What | How it signs in | Campaign |
|---|---|---|---|
| YouTube Shorts | the race video, title "… #Shorts", description with the tracked link | Google OAuth (refresh token) | `YTSHORTS` |
| Instagram (Reels) | the race video; the weekly top as a JPEG card; "link in bio" (links in captions are not clickable) | with Facebook: the Professional account linked to the game's Page | `IGREELS` |
| Facebook Page | the race video; the weekly top as a photo | Facebook Login for Business (Page token, does not expire) | `FBPAGE` |
| Threads | the race video; the weekly top as an image (≤ 500 characters, one hashtag) | Threads OAuth (60-day token, renewed by the API) | `THREADSPOST` |
| Bluesky | the card with clickable link and hashtags (≤ 300 characters) | handle + app password on the server | `BSKYPOST` |

The text is the channel post's, as plain English, with "Free horse racing sim in Telegram · no
betting." and a link `t.me/<bot>/<app>?startapp=race_<id>_c<CODE>` (opens the race's replay and
credits the campaign). Each network: at most 2 posts a day, at least 4 h apart, 10:00–21:00 UTC
(`marketing.social.*`), one post per network per event, posted from a background loop (once a
minute, one post per round) so rendering never holds up the race jobs. Privacy rules are the
channel's: horse names only, stables only with consent, never Telegram names.

**Safety and operations** (admin console → marketing → **Other networks**): per network what is
connected (account name, token expiry), which server settings are missing, the campaign and the
tracked link for the profile's bio, recent posts with links, "Connect" / "Reconnect" (opens the
network's own sign-in in the browser), "Check", "Post next now" (skips the window and gap, never
the switches or the daily limit) and "Disconnect". Switches: all networks, and each one (audited
with the other marketing switches). Three failures in a row pause that network and message the
SUPER/CONTENT/ECONOMY admins once; "Resume posting" restarts it; reconnecting clears the pause.
Tokens are encrypted in `social_accounts` (AES-256-GCM, key derived from `JWT_SECRET`; if that
secret changes, the console asks to connect again). Sign-ins carry a signed, 30-minute `state`
naming the admin; connecting and disconnecting are audited.

**Owner setup for stage 3 (once per network; all free).** Everything goes into Railway → the API
service → Variables; nothing is pasted into chats. The console's "Redirect addresses to
register" shows the exact return addresses (`https://<api>/marketing/oauth/{google|meta|threads}/callback`).
The API's own address is taken from Railway's public domain (`API_PUBLIC_URL` overrides it).

1. **YouTube.** Create a YouTube channel for the game. In Google Cloud console: a project →
   enable *YouTube Data API v3* → OAuth consent screen (External; add the scopes
   `youtube.upload`, `youtube.readonly`; then **Publish app** — in "Testing" Google drops the
   sign-in after 7 days) → Credentials → OAuth client ID (Web application) with the Google
   redirect address. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, then **Connect** in the
   console with the Google account that owns the channel. Note: YouTube keeps uploads from a
   new, unaudited API project **private** until the project passes YouTube's free API compliance
   audit (Google Cloud → YouTube API Services → audit and quota extension form); until then the
   videos are on the channel but not public.
2. **Facebook + Instagram.** A Facebook Page for the game; the Instagram account switched to
   Professional (Business or Creator) and linked to that Page. In Meta for Developers: an app of
   type Business → add *Facebook Login for Business* (valid OAuth redirect URI: the Meta address)
   and *Instagram* (API setup with Facebook Login) → fill in the privacy policy URL → switch the
   app to **Live** (posts by an app in development mode are visible only to the app's admins).
   Set `META_APP_ID`, `META_APP_SECRET` (and `FACEBOOK_PAGE_ID` if the account manages several
   Pages), then **Connect** and allow the Page and its Instagram account. Put the Instagram bio
   link from the console in the profile.
3. **Threads.** In the same or another Meta app add the *Threads API* use case with the
   permissions `threads_basic`, `threads_content_publish` and the Threads redirect address as
   its callback; add the Threads account as a tester and accept the invite (Threads → Settings →
   Account → Website permissions). Set `THREADS_APP_ID`, `THREADS_APP_SECRET` (the Threads app's
   own id and secret), then **Connect**.
4. **Bluesky.** Create the account, then Settings → Privacy and security → App passwords → add
   one. Set `BLUESKY_HANDLE` (e.g. `thoroughline.bsky.social`) and `BLUESKY_APP_PASSWORD`.

After the next deploy each network shows "connected" and starts posting at the next window with
something new to post; "Post next now" tries one at once.
