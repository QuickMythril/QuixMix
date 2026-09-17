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
resources and finally a PLAYLIST resource. QuixMix hashes the exact published
bytes (after SRT conversion), makes stable content identifiers, and shares identical
files within the same service. Changed bytes get a new identifier. The final
playlist also gets a content-derived identifier so unchanged retries are stable.

Each accepted transaction receipt is saved before the queue advances. Confirmation
is independent; the queue only waits for room when 20 account transactions are
pending (Core's default per-account limit is 25). Pause stops before the next file.
After closing Home, select the same folder and account, then Publish/Resume. Files
are not stored in browser storage: you must reselect them. Keep QuixMix's storage
intact; publication stops if it cannot save recovery data.

Recovery checks saved signatures on the active node and compares previously
published bytes, including old randomly numbered QuixMix resources. Resource
listing sizes are compressed sizes, so they are not used as proof of a match.
An interrupted/unknown response cannot be safely retried merely because it is
missing on one node. Recovery shows its resource and known signature and consults
Home's pending journal when supported. Only clear failed attempts after checking
that they failed or were cancelled; clearing an uncertain attempt can duplicate it.

Home controls approval. Updated Home can grant Qortium publishing for this app tab,
account, owned name and current node route while unlocked. Existing desktop beta 11
requires per-resource approval until updated. Files over 25 MiB always retain Home's
native picker handoff. The album becomes playable as its submitted resources confirm
and become available; Submitted does not mean confirmed or readable.
