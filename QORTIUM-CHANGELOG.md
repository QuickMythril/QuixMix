# QuixMix changelog

## Change Entries

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
