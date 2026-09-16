# Playlist format v1

Store this JSON document as a PLAYLIST resource. All names below are illustrative.

```json
{
  "kind": "qortium-music-playlist",
  "schemaVersion": 1,
  "title": "My playlist",
  "tracks": [
    {
      "id": "track-1",
      "title": "First song",
      "artist": "Example artist",
      "defaultVersion": "audio",
      "switchPolicy": "aligned",
      "versions": {
        "audio": {
          "resource": {"service": "AUDIO", "name": "ExampleArtist", "identifier": "song-1"},
          "timelineOffsetMs": 0
        },
        "video": {
          "resource": {"service": "VIDEO", "name": "ExampleArtist", "identifier": "song-1-video"},
          "timelineOffsetMs": 3000
        }
      },
      "cover": {"service": "IMAGE", "name": "ExampleArtist", "identifier": "song-1-cover"},
      "lyrics": {"service": "FILE", "name": "ExampleArtist", "identifier": "song-1-lyrics-en", "format": "vtt", "language": "en", "offsetMs": 0},
      "commentary": {"service": "FILE", "name": "ExampleArtist", "identifier": "song-1-commentary-en", "format": "vtt", "language": "en", "offsetMs": 0}
    }
  ]
}
```

At least one media version is required. Missing `defaultVersion` selects audio
when present, otherwise video. Missing `switchPolicy` defaults to `restart`.
An explicit default must exist. Track IDs must be unique, but multiple entries
can reference the same media. A playlist may be empty while being authored.

Each version may supply `lyrics` and `commentary` overrides with the same FILE
reference shape as the track-level fields. An absent override inherits the track
setting; `null` disables that text for this version. Cover IMAGE is optional.

`timelineOffsetMs` places the start of the shared song timeline within each media
version. A 3,000 ms video offset means the shared song starts three seconds into
that video. Active cues satisfy:

```
start <= media.currentTime - timelineOffsetMs / 1000 - text.offsetMs / 1000 < end
```

For `aligned` switching, the new position is old position minus the old timeline
offset plus the new timeline offset, clamped to playable media bounds. Use aligned
only for matching edits. Different cuts use `restart` and separate text tracks.

FILE content is UTF-8 WebVTT, with independent files for lyrics and commentary:

```text
WEBVTT

00:00:12.000 --> 00:00:22.000
The second guitar enters here.
```

The app supports plain text, multiline cues, identifiers, NOTE blocks and overlap.
It rejects embedded markup, cue settings, STYLE and REGION rather than silently
interpreting them differently. Timings are seconds with millisecond precision.
The current cue ends exclusively at its end timestamp; gaps clear the overlay.

Resource names and identifiers are explicit. Media references may contain `path`
for a safe relative file path; covers and single FILE resources do not use paths.
Identifiers are at most 64 UTF-8 bytes; publisher names at most 40. Parsing bounds
are 1 MiB per manifest or WebVTT file, 2,000 tracks and 5,000 cues. Offsets are
integer milliseconds within plus/minus 24 hours.

Audio only is a saved listener preference, not part of this published manifest.
It makes VIDEO ineligible, including video prefetch. Resource tuples follow
updates; publish a distinct identifier when changing the underlying recording
would invalidate its text timing. Version pinning is not implemented.
