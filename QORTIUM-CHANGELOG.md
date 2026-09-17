# QuixMix changelog

## Change Entries

### 2026-09-17 — Show your playlists by default and link to a playlist directly

Release 0.2.3. Inside Home, Listen now opens with the playlists published by
the selected account's names, newest first, with each title and track count
read from the playlist itself; pick one to play it, and Refresh after
publishing. Listing uses only read actions, so it never prompts. Every opened
QDN playlist now has a direct link of the form
`qdn://APP/QuixMix/QuixMix#/playlist/<name>/<identifier>`, shown under the
title with a Copy link button; opening QuixMix through such a link plays that
playlist straight away, and the address updates as you switch playlists.
Outside Home the link uses the page address instead.

### 2026-09-17 — Publish picker files first

Release 0.2.2. Files over 25 MiB, which still need Home's file picker, are
now published before everything else, so the hands-on part of an album
publish finishes early and the remaining files run unattended. The order
within each group is unchanged, and resume still keys on saved receipts, so
albums already in progress carry on where they left off. The progress line
says how many picker files remain.

### 2026-09-17 — Record the verified QuixMix resumable-publishing release

Record the confirmed 0.2.1 APP transaction, exact served-build comparison and
published-route pilot import/preview. Home session approval remains a separate
local patched build awaiting installed runtime acceptance.

### 2026-09-17 — Make album publishing resumable and advance on submission

Release 0.2.1. Hash exact file bytes for stable identifiers and deduplication,
persist receipts before advancing, and recover legacy uploads through byte
comparison. Submit the playlist after all files are accepted or reused without
waiting for individual confirmations; pause at 20 pending account transactions.
Preserve Home errors and require explicit recovery for uncertain attempts.
Document the separate Home update needed for session approval.

### 2026-09-16 — Record the verified QuixMix folder-import release

Record the confirmed 0.2.0 QDN publication, exact build-file comparison and live
render verification of host theme following and local pilot folder preview.

### 2026-09-16 — Simplify album creation with folder import and Home theme following

Follow Home's qdnTheme in System mode while retaining manual overrides and device
fallback outside Home. Make folder selection, pairing review, local preview and
guided publication the main creation flow. Import numbered filenames and explicit
maps, convert SRT without time shifts, preserve per-version text, and retain the
manual editor under Advanced. Stage small media directly and use Home's picker for
files over 25 MiB, with in-session pause/resume and dependency readiness checks.
Release 0.2.0; no Home changes or pilot-media publication.

### 2026-09-16 — Record the verified QuixMix Previewnet release

Record the GitHub source, confirmed dedicated-name registration and APP publication,
exact served-file verification and successful QDN-rendered playback/editor smoke test.

### 2026-09-16 — Name the app QuixMix and prepare dedicated Previewnet publishing

Brand the app QuixMix and document QuickMythril/QuixMix. Require an explicit
publisher account, verify its key pair and address, restrict signing to a local
Previewnet node, and require a clean main checkout before publishing.

### 2026-09-16 — Unify light and dark themes with local Lexend typography

Follow the device theme by default, add saved System/Light/Dark selection, and use
shared neutral surfaces across the player and playlist editor. Apply Home's named
accent to controls and highlights while gateways default to neutral. Bundle Lexend
for the interface and timed text, with readable media overlays in either theme.

### 2026-09-16 — Keep cover images inside the player frame

Constrain audio covers to the player bounds so square artwork remains fully
visible on wide desktop layouts and narrow mobile screens.

### 2026-09-16 — Build the initial QDN music player

Add a local-first playlist player with paired audio/video versions, static covers,
Audio only mode, synchronized lyrics and commentary, mobile fullscreen overlays,
a playlist editor and Home-mediated resource upload flows. Include local-file
preview, original demo fixtures, validation and browser regressions so the app can
be tried before choosing a QDN publication identity.
