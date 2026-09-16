# Initial implementation status

Date: 2026-09-16 (America/New_York; verified 13:37 UTC).
Repository: `/home/user/qortium/git/qortium-music`.
Working title: Music. Local implementation only; no remote or QDN app publication.

## Implemented

- Mixed AUDIO/VIDEO PLAYLIST schema, paired versions, IMAGE covers and independent
  FILE/WebVTT lyrics/commentary; creator offsets and per-version text overrides.
- Persistent player, queue, seek, volume/speed, shuffle/repeat, cue transcripts and
  clickable passages; top commentary/bottom lyrics and container fullscreen.
- Saved Audio only preference, video-only skipping, no video prefetch when enabled,
  safe switching and bounded media failure handling. Ordered mode warms one next
  eligible QDN resource and its timed text; shuffle/repeat-one skip prefetch.
- Local-file preview with no upload, original self-contained sample media, QDN
  playlist loading, JSON import/export, editor forms and recoverable browser drafts.
- Home account/name capability checks, picker/staged-source upload, resource
  dependency checks and signature-aware readiness. A pending-upload journal avoids
  duplicate submission on retry, missing signatures or lost responses. Recovery
  reports when it only confirmed a previous upload; changed bytes require a new
  explicit upload after that recovery. Unknown outcomes require inspecting Home's
  pending transactions before any manual recovery/replacement.

## Verification

- `npm test`: 57 tests across schema, timing, QDN contracts and browser fallback.
- `npm run build`: TypeScript and production Vite build pass.
- Playwright: 14 distinct browser tests pass (11 player + 3 local-preview/fullscreen).
  Includes actual Chromium media playback, seek/cue behavior, repeat/manual skip,
  late play rejection, loading-mode changes, unavailable tracks, ordered prefetch,
  persisted Audio only with no MP4 requests, mobile 390x844 layout, rejected
  fullscreen fallback, true container fullscreen, and malformed input preservation.
- Desktop/mobile screenshots in `docs/screenshots/` were captured and inspected.
- Live read-only Core check: fully synced local node; qdnClient resolved
  AUDIO/QortiumHomeTest/home-audio-mp3 and Chromium reported 60-second duration,
  readyState 4. No new resources were published by this work.
- Home API contracts checked in current desktop/Android source. QDN write flows
  verified through mocked bridge contracts; no real account transaction was signed.

## Remaining acceptance and scope

- Actual packaged Home desktop/Android playback, fullscreen, upload permissions
  and source-token execution need a live acceptance pass. Mobile viewport Chromium
  tests are not physical-device or installed-Home proof.
- Select an app title and APP publisher/identifier before test publication. The
  helper requires an explicit QORTIUM_MUSIC_QDN_NAME and is Previewnet-oriented.
- No gapless/crossfade, offline library, word-level karaoke, LRC/SRT conversion,
  historical version pinning or synchronization of silent VIDEO with separate AUDIO.
- The local preview is one track at a time. Local File objects are session-only;
  saved playlists reference QDN resources and need uploaded media/text identities.
- Browser storage is best effort; JSON export provides a portable copy of a draft.

## Implementation provenance

Used the QDN app-builder starter and current local Core/Home/Radio source patterns.
Two Codex Sol agents (high effort) handled schema/timing, editor and focused tests.
A Claude Sonnet high-effort MCP task was attempted for QDN integration. Its sandbox
could not read the reference repositories, and its provisional bridge assumptions
were incorrect; the stalled worker was stopped. Parent replaced the integration
with source-verified actions and independent contract tests before accepting it.
No other repositories' runtime behavior was changed.

## Resume

```sh
cd /home/user/qortium/git/qortium-music
npm ci
npm run dev -- --host 127.0.0.1 --port 4183
npm test
npm run build
npm run test:browser
```

## Appearance update — 2026-09-16

The editor's separate hardcoded light palette was replaced with shared semantic
colors, fixing its mismatch with the player. System/Light/Dark selection now
persists locally. System follows the device even inside Home; Home's accent is
independent, restricted to named supported colors, and scoped to controls and
highlights. Gateway/domain-mapped defaults remain neutral. Lexend Variable is
bundled locally with its font license and used in the UI, lyrics and commentary.

Seven new browser tests verify live system changes, saved overrides, Home accent
messages/query precedence, gateway neutrality, editor/player contrast, actual
Lexend glyph rendering through Chromium's platform-font inspection, and mobile
390x844 bounds. Screenshots in `docs/screenshots/` with `-light` / `-dark` suffixes
show the updated UI. The earlier unsuffixed screenshots record the initial MVP.

Current validation: 57 unit/contract tests, 21 browser tests (14 playback/preview
plus 7 appearance), and production build. Appearance integration is verified with
Home-shaped injected values/messages; installed Home and physical-device acceptance
remain pending. Naming, registration, GitHub repository creation and QDN publication
follow the user's visual review and choice of app name.
