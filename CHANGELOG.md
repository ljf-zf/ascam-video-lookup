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
