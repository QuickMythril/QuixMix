# QuixMix for Qortium

A static QDN playlist player for audio, video, synchronized lyrics and timed text
commentary. Built with React, TypeScript and Vite. App name: **QuixMix**.
Source: [QuickMythril/QuixMix](https://github.com/QuickMythril/QuixMix).
Previewnet identity: `APP/QuixMix/QuixMix`.

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

## Commentary links

Commentary is hidden and disabled on normal playlist links, demo playback and
local previews. To show its checkbox, timed overlay and transcript, append
`?commentary=true` inside a direct playlist link's fragment:

```text
qdn://APP/QuixMix/QuixMix#/playlist/Owner/playlist-identifier?commentary=true
```

The checkbox starts checked; listeners can uncheck it during that visit.
Copy link preserves the opt-in. Only a single, exact `commentary=true` enables
it; missing, false, invalid or duplicated values leave it hidden. Commentary
files are not loaded or prefetched without the opt-in. Changing this option
on the current playlist does not restart its audio or video.

## Playback

- Each playlist entry can contain AUDIO, VIDEO, or both versions.
- Audio uses an optional IMAGE cover. Video plays its own embedded soundtrack.
- Lyrics appear at the bottom; opted-in commentary appears at the top. Text follows the active
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
Home `qdnTheme` live inside Home and the device preference elsewhere. A manual
choice is saved locally and overrides both. Player, preview and playlist editor share one palette.

Surfaces stay neutral. In Home, named `qdnAccent` colors are read from the host
query/globals and updated by `ACCENT_CHANGED` / `DISPLAY_SETTINGS_CHANGED`.
Standalone browser/gateway use defaults to neutral, including when Core injects
its own gateway display defaults. No external font requests are made: the app
bundles **Lexend Variable**, including its SIL Open Font License at
`public/fonts/lexend-license.txt`. Subtitles, commentary and form text use Lexend;
unsupported glyphs can use the system fallback. Media overlays always retain
light text on dark backdrops for readability over audio artwork and video.

## Playlist authoring

**Create playlist** starts with a folder picker. Matching audio, video, cover and
SRT/WebVTT filenames become ordered tracks without entering resource identifiers.
Review the compact list, preview locally, connect your Home account, then publish.
Separate audio/video subtitle files keep their own timestamps; no automatic time
shifts are added. SRT is converted to WebVTT without changing the original files.
See [folder import](docs/folder-import.md) for conventions and exact import maps.

Files up to 25 MiB are staged directly in Home. Larger media use Home's picker,
with filename/size checked before submission and Home's returned SHA-256 checked
afterward. Home owns approval/signing; no private keys belong in this app.
The folder queue advances on transaction submission, saves receipts, and checks
existing bytes before reusing files. Reselect the same folder and account after
closing Home to resume. Changed bytes receive new identifiers; identical files
within a service are shared. Legacy random identifiers are recovered by comparing
actual published bytes. Uncertain attempts stop for recovery rather than retrying
automatically. The PLAYLIST is submitted after all files are submitted or verified;
playback can wait until the resources confirm and become available.

The queue waits when the account has 20 or more pending transactions, retaining
headroom below Core's default limit of 25. A node configured with a lower limit
can still reject a submission. Session approval requires the corresponding Home
update; desktop beta 11's existing build still prompts per resource. The updated
Home scope lasts only for the app tab, unlocked account, publishing name and node
route. Large files still require native picker selections.

The former full resource editor is available under **Advanced: edit QDN references
manually**, with JSON import/export, version offsets and browser drafts.

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

App publication is a separate step. After choosing the target identity, run
`npm run build`, then configure the generated preview publishing helper with
`QUIXMIX_QDN_NAME` and `QUIXMIX_ACCOUNT_PATH`. The account JSON must contain
`accountAddress`, `accountPublicKey` and `accountPrivateKey`; keep that file
outside the repository. The helper publishes the `APP` resource under the
`QuixMix` identifier with the `QuixMix` title by default. It accepts only a
trusted loopback Qortium Core API and is intended for the configured Previewnet
account, not production wallets.

## Demo provenance

All demo text and SVG cover artwork were created for this app. Audio is a quiet
synthetic 220/330 Hz test chord generated with FFmpeg; video is FFmpeg's testsrc2
pattern using that chord. Demo track labels demonstrate resource combinations,
not distinct commercial recordings. No third-party music or lyrics are included.
