# ASCAM Video Lookup v1.3.7 – Instant Camera / P2P

## Immediate camera playback

- Direct playback/download uses `GET /api/v1/videos/{sessionId}/download?camId={cameraId}`.
- `cameraId` is the **numeric API camera ID** from `cameras[].cameraId`, not the station-local RTSP labels such as `tc-b-3` or `vd-b-3`.
- The ASCAM API documentation example maps `cameraId: 1` to `role: "overview"` and `cameraId: 2` to `role: "scanner"`. When the order/session response supplies `cameras[]`, the app resolves IDs from that array by role/name. If it does not, the UI explicitly marks the documented `1/2` fallback.
- The merged stream remains explicit: `GET /api/v1/videos/{sessionId}/download?merged=1`.
- Playback uses browser `Range` requests and a streaming proxy; it does not first download or generate the merged MP4.

## Fast P2P share links

- Overview share: `POST /api/v1/orders/{orderCode}/share` with `{ mode: "p2p", role: "main", lang: "vi", theme: "dark" }`.
- Waybill share: the same endpoint with `mode: "p2p", role: "sub"`.
- Merged/archive share: `{ storage: "cloud", role: "merged", ... }`; this can take longer because ASCAM creates/uploads the merged asset.
- P2P is intended to avoid pre-uploading the MP4 to ASC-Cloud. The ASCAM peer/node at the store must remain online for P2P playback. The share API is documented at order scope, not session scope, so for orders with multiple sessions the selected session may not be guaranteed by that share endpoint. Use direct `/stream?sessionId=...&camId=...` for the selected session.

## Deploy without installing Node.js

1. Upload the **contents** of this project to the root of the GitHub repository connected to Cloudflare Pages (do not upload the ZIP itself).
2. Cloudflare Pages build settings: Framework preset `None`, build command empty, build output directory `public`, root directory `/`.
3. Commit to the production branch and let Cloudflare Pages deploy.
4. Keep encrypted Production Secrets: `APP_PASSWORD`, `SESSION_SECRET`, and `ASCAM_API_TOKEN`.
5. `ASCAM_API_BASE` defaults in `wrangler.toml` to `https://goldentech.ghihinh.com/api/v1`. If the Cloudflare dashboard has an override, update it to this same Hybrid-Cloud URL. A store-PC Tunnel is not required for these Hybrid-Cloud API calls. Never put the API token in GitHub.

## Relevant Pages API routes

- `GET /api/status`, `/api/search?q=...`, `/api/order?code=...`
- `GET /api/stream?sessionId=...&camId=<numeric cameraId>` for direct original camera streaming; omit `camId` only for explicit merged playback.
- `GET /api/download?sessionId=...&camId=<numeric cameraId>` for direct camera download.
- `GET /api/camera-diagnose?sessionId=...&mode=overview|waybill|merged` for bounded sample/fingerprint diagnostics.
- `POST /api/share` selects P2P main/sub for camera share and Cloud merged for archive/merged share.

## Security and operational notes

- `APP_PASSWORD`, `SESSION_SECRET`, and `ASCAM_API_TOKEN` must remain encrypted Cloudflare Secrets.
- The bearer token is read only by the Pages Function and is not returned to the browser.
- Login cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, and expires after 10 hours.
- Direct MP4 streaming uses the selected `sessionId` plus numeric `cameraId`; it is separate from order-level P2P share links.
- P2P removes the need for the user to keep a manual Cloudflare Tunnel running, but it is not an offline path: the ASCAM node/peer must be online.
- Merged video generation/ASC-Cloud upload is intentionally a separate, slower operation.


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
5. `ASCAM_API_BASE` is a non-secret text variable managed in `wrangler.toml` under `[vars]`. The default is the public ASCAM Hybrid-Cloud endpoint `https://goldentech.ghihinh.com/api/v1`. This direct endpoint avoids requiring a Cloudflare Tunnel or an always-on store-PC connector. If Cloudflare Dashboard has an existing `ASCAM_API_BASE` variable, update it to the same Hybrid-Cloud value; Dashboard variables can override the repository default. Never put the API token in this file.

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


## v1.3.1 Direct Camera
- Overview resolves to the station camera ID `tc-b-N` (example: `tc-b-3`).
- Waybill resolves to `vd-b-N` (example: `vd-b-3`).
- These IDs are sent as `camId` to `GET /api/v1/videos/{sessionId}/download`.
- Merged playback remains a separate explicit mode using `merged=1`.
- Camera probes request only `Range: bytes=0-0`, cancel the response body after headers, and time out after 5 seconds.
- API JSON calls have bounded timeouts; video streaming continues to forward the browser's Range header without buffering the MP4.


## v1.3.2 Stream connection timeout
The video proxy waits up to 45 seconds for ASCAM to return response headers. This timeout applies only to opening the upstream connection; it is cleared as soon as headers arrive and does not cap the MP4 playback duration. If the upstream does not open in time, the API returns HTTP 504 with `UPSTREAM_CONNECT_TIMEOUT`.


## v1.3.3 Bounded Source Diagnostics

This release adds an authenticated, sequential diagnostic for a completed session. It requests at most the first 64 KiB from Overview, Waybill, or merged mode and returns response metadata plus a SHA-256 fingerprint. It never returns or stores the MP4 sample. Run each diagnostic button separately; compare the fingerprints to determine whether ASCAM serves distinct source bytes. The playback routes are deliberately unchanged in this diagnostic release.


## v1.3.4 Hybrid-Cloud no-cache camera routing
- Uses the public Hybrid-Cloud API by default; no Cloudflare Tunnel is needed for API calls.
- Upstream camera diagnostic and playback fetches explicitly bypass HTTP/CDN cache using `cache: "no-store"` and no-store headers.
- This guards against a CDN cache key that ignores query parameters and incorrectly reuses the merged response for `camId` requests.
- Diagnostics sample a 64 KiB range at byte offset 1 MiB to compare encoded video data rather than only shared MP4 initialization bytes.
- Includes upstream cache metadata where supplied by the origin.
