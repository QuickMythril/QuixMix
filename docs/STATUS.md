# Initial implementation status

Date: 2026-09-16 (America/New_York; verified 13:37 UTC).
Repository: `/home/user/qortium/git/qortium-music`.
App name: QuixMix. GitHub target: QuickMythril/QuixMix.
Previewnet publication target: APP/QuixMix/QuixMix.

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
- Dedicated publisher selected; the helper requires explicit QUIXMIX_QDN_NAME
  and QUIXMIX_ACCOUNT_PATH and is restricted to local Previewnet.
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
persists locally. This was the initial behavior: System followed the device even inside Home; Home's accent was
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

## QuixMix release preparation — 2026-09-16

The user selected QuixMix and QuickMythril/QuixMix. Existing playlist schema and
browser preference keys remain compatible. Publishing uses a dedicated account;
private material is held outside the repository. The helper verifies the key pair,
address, local Previewnet identity, sync, name ownership and clean main checkout.

Release checks: 57 unit/contract tests, 21 browser tests and the production build passed. Publisher
input guards reject missing identity/account configuration and non-loopback nodes.
A read-only Claude Sonnet high-effort review found a name-lookup redirect gap;
redirect following is now disabled there too. The parent verified registration
serialization directly against Core's current RegisterName transformer.

## Published release — 2026-09-16

- Public source: https://github.com/QuickMythril/QuixMix, main commit `87b62fc`.
- Resource: `qdn://APP/QuixMix/QuixMix`, title QuixMix, Previewnet.
- Dedicated owner: `QbJc2MsUFXraahwhioVE4iCmJMJ9CETdpF`.
- Name registration and APP publication both returned in Core's CONFIRMED search.
- Registration: `3a6wiNBSyBFhTq41otGWP5LS3ipaixDucGe5pCrqLcwSXoWZYQiaEN6vajN6623wJToAPUpSngiStqc2RnTiPyao`.
- Publication: `eyHiT7ksvqnQrEbEbLE4gmoiCWzy2oCvoEXVG6cmzRk6S7VdSXpLxFzds1LBkSmmY5VjSCKd66gS8oxypYLF1ss`.
- All 12 served files match the clean-main production build byte-for-byte.
- Core render route opened successfully in Chromium; actual demo video playback
  advanced, the dark editor rendered, and there were no page errors.
- This supersedes the initial no-publication status above. Installed Home and
  physical Android acceptance, including the first real playlist upload, remain
  user acceptance work. The publisher account's private material is outside git.

## Folder authoring and Home theme correction — 2026-09-16

System now follows qdnTheme inside Home, including live changes, and the OS outside
Home. Manual choices still override. This supersedes the initial Home theme policy
above. Create playlist now starts with folder import, compact pairing review and
local preview; the manual resource editor remains in Advanced. A guided upload
queue stages files up to Home's 25 MiB cap and uses its native picker for larger
files, checks selection metadata, retains completed uploads in-session, and waits
for dependencies before publishing PLAYLIST. SRT imports convert to WebVTT while
preserving source timestamps. Exact import maps handle existing album layouts.
No Home source changes are included. Pilot assets remain local and unchanged.

Release 0.2.0 validation: 103 unit/contract tests and 26 browser tests passed.
The local pilot imported 13 tracks / 65 files, excluded historical/unused files,
and loaded both actual media versions. All 26 SRT conversions (1,306 cues)
preserved text and start/end timestamps; all 13 approved video subtitle SHA-256
hashes remained unchanged. Only You and Anthem retained distinct durations and
restart behavior. Mobile 390px imported-album bounds were checked. These are local
Chromium and mocked publishing proofs, not a claim of a completed album upload.

0.2.0 publication: source `cd264de`, `APP/QuixMix/QuixMix`, confirmed signature
`4dPFCLCxwn78Gev9NxaLsVAwM4KE7SdY9K9UNjmTZzWH2yAvvQMDLYbjHia6dE4FDfQfSchEWJVJ2stFBzzv6WTY`.
All 12 served files match the production build. The published Core render route
applied the supplied dark host theme against a light OS, imported the 13-track
pilot and loaded its video preview without page errors. No pilot resources were
published. Home source remains unchanged; large media still use its native picker.

## Submission and recovery update — 2026-09-17

0.2.1 supersedes the folder queue's session-only progress and per-file readiness
wait. The queue uses exact-byte SHA-256 identities, saves write-ahead attempts and
accepted receipts, advances on submission, and reconstructs reuse after folder
reselection. Old numbered QuixMix resources are compared by actual bytes. Unknown
outcomes block automatic resubmission and expose an explicit checked-failure
recovery action. Storage failures block publication. A 20-pending-transaction
threshold leaves room below Core's default per-account cap of 25; lower custom
node limits can still reject writes. PLAYLIST submission does not imply readiness.

The user's first AUDIO/QuickMythril/quixmix-8347f9638e18a44cd6caf80f-1 is confirmed
and exactly matches the pilot's first MP3 (SHA-256
7765763a868a9ae204932d033c8f513186fb6d87c7becd91ce53faa963a27a53).
The second attempt's original Home error was hidden by 0.2.0; its cause remains
unknown. Closing Home does not remove the confirmed resource. No pilot media was
published by this implementation work.

A separate Home source change adds scoped session approval for Qortium publishing.
That is not present in the user's existing desktop beta 11 installation. QuixMix
cannot grant itself that authority. Home installation/live acceptance remains
separate from the app's mocked bridge and browser checks.

Validation: 126 unit/contract tests and TypeScript/production build pass. The full
26-test browser suite passed, followed by all 4 folder browser tests on the final
queue changes (27 distinct browser cases total). The latter include reload/resume
without readiness checks and mobile unknown-outcome blocking/manual recovery.
An independent publication-state review's receipt-preservation and lost-manifest
findings were corrected and regression-tested.

A read-only Chromium smoke imported the actual 13-track pilot, deduplicated its
65 references to 56 byte-distinct resources, reused the first published AUDIO,
and stopped at staging the next VIDEO; all signing/publication actions were
blocked by the test bridge. No page errors occurred.
