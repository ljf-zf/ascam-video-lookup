## 1.3.4 - Hybrid-Cloud No-Cache Camera Routing

- Sets `cache: "no-store"` on upstream camera diagnostics and video stream/download requests.
- Adds no-store request headers to avoid a CDN/cache key that omits `camId` returning the same merged response for every mode.
- Moves diagnostics to a bounded 64 KiB sample at byte offset 1 MiB, after common MP4 initialization data, to better compare actual video payload.
- Reports upstream cache status, Age, and Cache-Control metadata when available.
- Sets the default `ASCAM_API_BASE` to the public Hybrid-Cloud API; Cloudflare Tunnel is no longer required for the default configuration.
- Preserves the three explicit modes: `camId=tc-b-N`, `camId=vd-b-N`, and `merged=1`.

## 1.3.3 - Bounded Source Diagnostics

- Added a sequential diagnostic endpoint for Overview, Waybill, and merged video sources.
- Requests only bytes 0-65535 (64 KiB) and computes a SHA-256 fingerprint in memory.
- Does not return, persist, or buffer a full MP4; cancels ignored/unbounded responses.
- Reports upstream status, Content-Range, Content-Type, ETag, bytes read, hash, and elapsed time.
- Keeps the actual playback endpoints unchanged so the diagnostic isolates source behavior from player behavior.

## v1.3.2 Stream Connect Timeout
- Increased only the upstream video-header connection timeout from 12s to 45s; it is cleared immediately after headers arrive, so it does not limit playback duration.
- Returns HTTP 504 with a structured diagnostic code when ASCAM does not open the stream in time.
- Preserves direct camera IDs (`tc-b-N` / `vd-b-N`), merged mode, Range forwarding, and client-disconnect cancellation.

# Changelog

## V1.2.0 · Smart Workspace
- Reorganized the authenticated workspace around a persistent left navigation rail.
- Added dedicated Overview, Search History, and Bookmarked Orders views.
- Added local bookmark/unbookmark workflow for orders that need follow-up.
- Kept the existing login, status, search, order detail, ASC-Cloud share, merged stream, and MP4 download API routes unchanged.
- Added responsive mobile drawer navigation and compact layouts for phones.
- Kept search history and bookmarks local to the current browser profile.

## V1.1.0 · Focus Cinema
- Refined the dark Focus Cinema interface and improved responsive behavior.

## v1.2.1 — Safe camera Range diagnostics
- Added authenticated `GET /api/camera-check?sessionId=...&camId=overview|waybill`.
- Sends `Range: bytes=0-0` to ASCAM and inspects response headers only.
- Cancels the upstream MP4 body immediately after headers; never buffers or streams the video to the browser during diagnostics.
- Added separate UI actions to test the `overview` and `waybill` role values as candidate `camId` values.
- Existing merged video, order search, bookmarks, login, and ASC-Cloud sharing routes are unchanged.
- A successful HTTP 206 confirms Range was honored. HTTP 200 is reported as inconclusive because ASCAM may have ignored Range; the body is still canceled immediately.


## 1.3.0 - Quick Playback
- Added direct Overview and Waybill MP4 playback using the camera IDs confirmed by successful HTTP 206 probes.
- Added explicit Merged Video playback without requiring an ASC-Cloud share first.
- Extended authenticated stream/download endpoints to accept a whitelisted `camId`, forward Range headers, and stream bytes through Pages Functions.
- Kept ASC-Cloud sharing as a separate action and preserved existing merged-video behavior.


## 1.3.1 - Direct Camera IDs & API Safety
- Fixed camera playback to use the actual ASCAM camera IDs from station configuration: `tc-b-N` for Overview and `vd-b-N` for Waybill.
- Fixed the one-byte camera probe to test the same real camera IDs used by playback.
- Kept merged playback separate: only the explicit Video ghép mode sends `merged=1`.
- Added bounded timeouts to JSON API calls and a shorter timeout to the one-byte probe.
- Prevented simultaneous camera probes from the UI.
- Preserved Range forwarding and streaming response bodies; video streams are not buffered by the Pages Function.
