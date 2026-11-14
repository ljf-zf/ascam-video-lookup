# Changelog

## 1.3.2 — Use configured camera IDs per station
- Replaced guessed role strings (`overview` / `waybill`) with ASCAM's configured camera IDs.
- Overview resolves to `tc-<stationId>` and Waybill resolves to `vd-<stationId>` using the selected session's `stationId` (for example, station `b-3` maps to `tc-b-3` and `vd-b-3`).
- Applied the same mapping to direct playback, MP4 download, and one-byte Range diagnostics.
- Backend now validates actual camera-ID formats rather than accepting role names.
- Merged playback remains a separate `merged=1` stream and does not require creating an ASC-Cloud share first.
- No station or camera ID is hard-coded to a single packing table; the mapping follows each selected session.


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
- Added authenticated `GET /api/camera-check?sessionId=...&camId=tc-b-N|vd-b-N`.
- Sends `Range: bytes=0-0` to ASCAM and inspects response headers only.
- Cancels the upstream MP4 body immediately after headers; never buffers or streams the video to the browser during diagnostics.
- Added separate UI actions to test the configured `tc-b-N` and `vd-b-N` camera IDs.
- Existing merged video, order search, bookmarks, login, and ASC-Cloud sharing routes are unchanged.
- A successful HTTP 206 confirms Range was honored. HTTP 200 is reported as inconclusive because ASCAM may have ignored Range; the body is still canceled immediately.


## 1.3.0 - Quick Playback
- Added direct Overview and Waybill MP4 playback using the camera IDs confirmed by successful HTTP 206 probes.
- Added explicit Merged Video playback without requiring an ASC-Cloud share first.
- Extended authenticated stream/download endpoints to accept a whitelisted `camId`, forward Range headers, and stream bytes through Pages Functions.
- Kept ASC-Cloud sharing as a separate action and preserved existing merged-video behavior.


## 1.3.1 — Quick Playback Fix
- Improved byte-range forwarding and progressive first request behavior.
- Added identity encoding and safe response header forwarding.
- Validates upstream video content type and exposes clearer stream errors.
- Added player status messages for metadata, readiness, stalls, and playback errors.
