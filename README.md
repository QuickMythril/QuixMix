# Music for Qortium

A static QDN playlist player for audio, video, synchronized lyrics and timed text
commentary. Built with React, TypeScript and Vite. Working app title: **Music**.
No QDN publishing identity has been selected or registered.

## Run locally

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 4183
```

Open http://127.0.0.1:4183. The included 18-second synthetic demo needs no node.
Use **Preview your files before uploading** for local audio/video, a cover and
WebVTT files. Local preview files remain in this browser session and are not
uploaded. Their placeholder resource names must be replaced by uploaded QDN
resources before publishing a playlist.

Use **Open a QDN playlist** to load a publisher/identifier through Home's bridge,
or through the local Core in browser development. Set `VITE_QORTIUM_NODE_API_URL`
for a different development Core. Browser development only permits reads.

## Playback

- Each playlist entry can contain AUDIO, VIDEO, or both versions.
- Audio uses an optional IMAGE cover. Video plays its own embedded soundtrack.
- Lyrics appear at the bottom; commentary at the top. Text follows the active
  media clock, including seek, buffering, pause and playback-rate changes.
- Fullscreen includes the video, overlays and controls. If the host rejects
  container fullscreen, an explicitly labelled expanded view preserves overlays.
- **Audio only** persists locally, selects AUDIO resources, skips video-only
  tracks and never hides a downloaded video's picture as an audio substitute.
- Aligned version switching preserves position with creator-supplied offsets;
  different edits restart. Per-version text overrides can replace or disable
  inherited lyrics/commentary.
- Missing text/cover does not stop media. Failed tracks are skipped with bounded
  attempts; an entirely unavailable queue stops.

## Appearance

The **Theme** dropdown offers System (default), Light and Dark. System tracks the
device preference live; a manual choice is saved locally and wins over system or
Home theme messages. Player, preview and playlist editor share one palette.

Surfaces stay neutral. In Home, named `qdnAccent` colors are read from the host
query/globals and updated by `ACCENT_CHANGED` / `DISPLAY_SETTINGS_CHANGED`.
Standalone browser/gateway use defaults to neutral, including when Core injects
its own gateway display defaults. No external font requests are made: the app
bundles **Lexend Variable**, including its SIL Open Font License at
`public/fonts/lexend-license.txt`. Subtitles, commentary and form text use Lexend;
unsupported glyphs can use the system fallback. Media overlays always retain
light text on dark backdrops for readability over audio artwork and video.

## Playlist authoring

**Create playlist** edits resources, versions, offsets and track ordering, imports
or exports JSON, and keeps a browser draft. In Home, owned-name selection enables
source-token resource upload and PLAYLIST publication. Audio/video/image uploads
use Home's picker; WebVTT and playlist JSON use staged bytes. Account ownership
must still match immediately before publishing. No private keys belong in this app.

Upload resources before publishing their playlist. Publications are separate
transactions; keep successful references in the draft and retry only missing
resources. An accepted transaction is not automatically confirmed/readable.

## Format

See `docs/playlist-format.md` for an example. The manifest has
`kind: "qortium-music-playlist"` and `schemaVersion: 1`, and is stored under
PLAYLIST. Track IDs are unique within a playlist; resource tuples can repeat.
Media services are AUDIO/VIDEO, covers IMAGE, and timed text FILE containing UTF-8
WebVTT. References have `service`, `name`, `identifier` and an optional relative
`path` for media resources. QDN identifiers are limited to 64 UTF-8 bytes.

Supported WebVTT subset: timestamped plain text, multiline text, optional cue
identifiers, NOTE blocks and overlapping cues. Cue settings, embedded markup,
STYLE and REGION are rejected with an explanation. Limits: 1 MiB manifest/text,
2,000 tracks, 5,000 cues. Resources use current tuple versions; immutable historical
pinning and LRC/SRT conversion are not implemented.

## Verify

```sh
npm test
npm run build
npm run test:browser
```

Browser tests use `/usr/bin/chromium`, overridable with `CHROMIUM_PATH`, and port
4183. See `docs/STATUS.md` for observed verification and remaining host acceptance.

App publication is a separate step. The generated preview publishing helper
requires explicit `QORTIUM_MUSIC_QDN_NAME`; do not use it until the target/account
is chosen. The helper is for configured Previewnet accounts, not production wallets.

## Demo provenance

All demo text and SVG cover artwork were created for this app. Audio is a quiet
synthetic 220/330 Hz test chord generated with FFmpeg; video is FFmpeg's testsrc2
pattern using that chord. Demo track labels demonstrate resource combinations,
not distinct commercial recordings. No third-party music or lyrics are included.
