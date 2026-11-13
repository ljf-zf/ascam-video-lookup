# ASCAM Video Lookup V1.0

Private Cloudflare Pages portal for searching ASCAM packing orders, creating ASC-Cloud merged share links, and streaming merged MP4 downloads through an authenticated backend.

## Architecture
- Cloudflare Pages serves `public/`.
- Pages Function `functions/api/[[path]].js` is the backend.
- `ASCAM_API_TOKEN`, `APP_PASSWORD`, and `SESSION_SECRET` are Cloudflare Pages secrets.
- ASCAM's local API is reached through an HTTPS Cloudflare Tunnel.
- The portal streams the selected session MP4 in-page through an authenticated backend route; the ASC-Cloud share link is also provided separately.

## Security first
The ASCAM Bearer token appeared in screenshots and pasted API output. Revoke/rotate it before deployment. Never commit real tokens or put them in frontend files. Share links are bearer links; anyone who has a live link may be able to view that video until expiry.

## 1. Cloudflare Tunnel from the shop PC
The supplied ASCAM docs show an example local API listener at `http://127.0.0.1:8090`. Confirm that exact port is active on the shop PC. For a first test, install `cloudflared` and run:

```bash
cloudflared tunnel --url http://127.0.0.1:8090
```

Keep the process running. It prints a temporary `https://....trycloudflare.com` URL. Put that URL plus `/api/v1` into `ASCAM_API_BASE` in `wrangler.toml`. Quick Tunnel URLs may change after restart; for stable production use a named Tunnel with a hostname on a domain managed by Cloudflare.

## 2. Install Wrangler and log in

```bash
npm install
npx wrangler login
```

## 3. Create the Pages project and add secrets

```bash
npx wrangler pages project create ascam-video-lookup
npx wrangler pages secret put APP_PASSWORD --project-name ascam-video-lookup
npx wrangler pages secret put SESSION_SECRET --project-name ascam-video-lookup
npx wrangler pages secret put ASCAM_API_TOKEN --project-name ascam-video-lookup
```

Use a strong website password, a random session secret of at least 32 characters, and the newly rotated ASCAM Bearer token. Paste secrets only into Wrangler's prompts.

## 4. Deploy

```bash
npx wrangler pages deploy public --project-name ascam-video-lookup
```

The intended address is `https://ascam-video-lookup.pages.dev`.

## API routes
- `POST /api/login` — password login, HttpOnly Secure SameSite=Strict session cookie.
- `GET /api/me` — session check.
- `POST /api/logout` — clear session.
- `GET /api/search?q=...` — `GET /api/v1/orders?q=...&page=1&pageSize=500`.
- `GET /api/order?code=...` — `GET /api/v1/orders/{orderCode}`.
- `POST /api/share` — requests `storage=cloud`, `role=merged`, `lang=vi`, `theme=dark`.
- `GET /api/stream?sessionId=...` — inline MP4 playback through the authenticated backend.
- `GET /api/download?sessionId=...` — attachment download through the authenticated backend.

## V1.0.1 verification notes
- Four-digit search checks up to the first 500 results returned by ASCAM. Add pagination if the API has more matching results.
- The documented share endpoint accepts an order code, not a session ID. For orders with multiple packing sessions, verify which session ASCAM chooses for the share link. The in-page MP4 preview and download use the selected session ID.
- Search history is stored locally in each browser.
- Cloudflare Quick Tunnel URLs are temporary. Use a named Tunnel for stable production.
- Configure Cloudflare rate limiting for `/api/login` before wider team use.
