# Folder import

Select one album folder in Create playlist. The normal layout is:

```text
My album/
  01 - Artist - Song.mp3
  01 - Artist - Song.mp4
  01 - Artist - Song.jpg
  01 - Artist - Song.audio.en.srt
  01 - Artist - Song.video.en.srt
  01 - Artist - Song.commentary.vtt
  02 - Artist - Another song.m4a
```

Leading numbers control numeric order. Without a number the importer uses filename
order. Matching stems pair media and covers. Shared `.srt`, `.en.srt` or `.vtt`
can serve both versions; explicit `.audio` and `.video` subtitles take precedence.
Use `.audio.commentary.srt` or `.video.commentary.srt` for version-specific notes.
Only album-root media are auto-discovered. Hidden/workbench files and nested media
are not automatically added. Ambiguous media/subtitle choices require an import
map instead of silently choosing a file. No media is renamed or rewritten.

## Exact import maps

An optional `quixmix-import.json` beside the album media supplies exact pairings:

```json
{
  "version": 1,
  "title": "My album",
  "tracks": [{
    "number": 1,
    "title": "Song",
    "artist": "Artist",
    "audio": "01 - Artist - Song.mp3",
    "video": "01 - Artist - Song.mp4",
    "cover": "01 - Artist - Song.jpg",
    "audioLyrics": "Subtitles/01 - Artist - Song.audio.en.srt",
    "videoLyrics": "Subtitles/01 - Artist - Song.video.en.srt",
    "switchPolicy": "restart"
  }]
}
```

All paths are relative to the selected folder. At least one media version is
required. `audioCommentary` and `videoCommentary` are optional. A missing reference
is an error; the importer will not replace it with a similarly named old file.
Use `restart` for different edits, or `aligned` only when the versions share the
same timeline. Default is restart. Timestamps already adjusted in the source SRT
are preserved. SRT conversion changes the container syntax to WebVTT, not timing.

Import/preview is local. Publishing uses separate AUDIO, VIDEO, IMAGE and FILE
resources and finally a PLAYLIST resource. QuixMix makes resource identifiers;
users only choose their publishing name. A fresh import gets fresh identifiers,
so it does not overwrite a different album. Completed uploads can be resumed
within the current session. A lost/unknown Home response stops the queue; inspect
Home's pending transactions before retrying an unresolved identifier. Do not
reload the page during publishing.
