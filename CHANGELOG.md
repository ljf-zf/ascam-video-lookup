# Changelog

## 1.1.0 — Focus Cinema
- Rebuilt the UI with a responsive Focus Cinema layout for desktop and mobile.
- Split website login state from ASCAM API connectivity state.
- Added authenticated `/api/status` health check with a 7-second timeout.
- Improved search result rendering and nested response parsing.
- Added clear messaging about the current first-page/500-record search limit.
- Added explicit disclosure that the currently verified ASCAM share endpoint is order-level, while MP4 streaming uses the selected session ID.
- Preserved the verified ASCAM merged-share payload and server-side Bearer token handling.
- Improved stream response header forwarding for byte-range video playback.
