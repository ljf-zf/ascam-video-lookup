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
