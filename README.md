# ASCAM Video Lookup v1.1.0 — Focus Cinema

Responsive private web portal for searching ASCAM packing orders, viewing order sessions, creating ASC-Cloud share links, and streaming/downloading merged MP4 through an authenticated Cloudflare Pages Function.

## Deploy without installing Node.js on your computer

1. Upload the contents of this project to the root of the GitHub repository connected to Cloudflare Pages (do not upload the ZIP itself).
2. Cloudflare Pages build settings:
   - Framework preset: `None`
   - Build command: empty
   - Build output directory: `public`
   - Root directory: `/`
3. Commit to the production branch. Cloudflare Pages automatically deploys the commit.
4. In Cloudflare Pages → Settings → Variables and secrets → Production, add encrypted Secrets:
   - `APP_PASSWORD`: private website login password
   - `SESSION_SECRET`: long random secret (32+ random characters)
   - `ASCAM_API_TOKEN`: ASCAM API bearer token (add only when ready to connect)
5. `ASCAM_API_BASE` is a non-secret text variable managed in `wrangler.toml` under `[vars]`. Replace the placeholder with the real HTTPS Cloudflare Tunnel origin when the store computer is online. It must be the Tunnel origin only, for example `https://your-tunnel-host.example.com`; the function appends `/api/v1` automatically. Never put the API token in this file.

Secrets are not committed to GitHub. After adding/changing Secrets in Cloudflare, ensure a new Production deployment is created so the active deployment receives the bindings.

## API routes

- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/status` — separately checks website session and ASCAM API health
- `GET /api/search?q=...`
- `GET /api/order?code=...`
- `POST /api/share`
- `GET /api/stream?sessionId=...`
- `GET /api/download?sessionId=...`
- `GET /api/camera-check?sessionId=...&camId=overview|waybill` — safe diagnostic probe; sends `Range: bytes=0-0`, returns only status/headers, and cancels the upstream video body immediately. `overview` and `waybill` are candidate values based on session roles, not yet confirmed camera IDs.

## Important API contract notes

- The share request preserves the previously tested ASCAM payload: `{ storage: "cloud", role: "merged", lang: "vi", theme: "dark" }`.
- The currently verified share endpoint is order-level (`POST /orders/{orderCode}/share`). The frontend makes this limitation explicit. It does not claim that ASCAM generated a share link for a specific selected session because the API contract for a session-specific share parameter has not yet been verified.
- Direct MP4 stream/download uses the selected session ID and `GET /videos/{sessionId}/download?merged=1`.
- Search currently requests page 1 with `pageSize=500`. It does not silently claim exhaustive pagination. If the target order is older than the first page, implement pagination after confirming ASCAM's response metadata and pagination contract.
- `GET /api/status` calls the documented ASCAM `GET /api/v1/health` endpoint. If the store PC or Tunnel is offline, the website remains available and displays ASCAM as offline/unavailable.

## Security

- `APP_PASSWORD`, `SESSION_SECRET`, and `ASCAM_API_TOKEN` must be encrypted Cloudflare Secrets.
- `ASCAM_API_TOKEN` is only read by the Pages Function and is never returned to the browser.
- Session cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, and expires after 10 hours.
- Do not paste real tokens, passwords, or live share URLs into GitHub issues or public repositories.

## Local development (optional)

Node.js is only needed if you choose to run Wrangler locally. It is not required on the end-user device or store PC for the hosted website. See `.dev.vars.example` for local-only placeholders; never commit a populated `.dev.vars` file.


## V1.2.0 interface notes
- Left navigation: Overview, Search History, and Orders to Review.
- Order bookmarks and search history are stored in the current browser's local storage; they are not synchronized across devices.
- Merged MP4 playback/download and ASC-Cloud sharing continue to use the existing authenticated Pages API routes.
- Mobile uses a slide-out navigation drawer and a single-column workspace.

## v1.2.1 safe camera diagnostics
- On an order detail, select a completed session and use **Kiểm tra overview** or **Kiểm tra waybill**.
- The diagnostic does not play or download MP4. It asks ASCAM for byte 0 only and cancels the response body as soon as headers arrive.
- HTTP 206 means Range was honored. HTTP 200 is inconclusive (the origin may have ignored Range); the body is still canceled. HTTP 400/404 may mean the candidate value is not a valid `camId`.
- This diagnostic does not change camera recording, ASCAM configuration, or the existing merged-video playback path.


## v1.3.0 Quick Playback
- Added direct MP4 playback for verified ASCAM camera roles `overview` and `waybill`.
- Added merged-video playback as a separate mode; ASC-Cloud sharing remains independent.
- `/api/stream` and `/api/download` accept `camId=overview|waybill`; omit `camId` to use the existing merged stream.
- Forwards browser HTTP Range requests and streams the upstream response without buffering the complete MP4.
- Bearer Token remains server-side.


## v1.3.1 — Quick Playback streaming reliability
- Stream requests now forward valid browser Range and If-Range headers unchanged.
- When a media player starts without a Range header, the Pages Function requests an open-ended `bytes=0-` range from ASCAM for progressive playback.
- Requests explicitly ask for identity encoding so byte ranges and Content-Length remain consistent.
- The stream route validates the upstream MP4 content type and reports upstream HTTP failures as actionable JSON instead of silently returning a non-video body.
- Preserves streaming response bodies without buffering the full MP4; only forwards Content-Length when safe.
- The player now reports metadata, can-play, stalled, and decode/network errors more clearly.


## Camera ID mapping (v1.3.2)

The selected ASCAM session must include its packing station ID (`stationId`, e.g. `b-3`). The app resolves the configured camera IDs dynamically:

- Overview: `tc-${stationId}` (e.g. `tc-b-3`)
- Waybill: `vd-${stationId}` (e.g. `vd-b-3`)
- Merged: `merged=1` (separate merged-video endpoint)

This mapping is used consistently for playback, MP4 download, and the one-byte Range probe. If the session does not include a valid `stationId`, the app reports that it cannot identify the source camera rather than guessing.
