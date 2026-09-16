import { describe, expect, it } from 'vitest';
import { importFolder, subtitleToVtt } from './folderImport';

function file(relativePath: string, content = 'x'): File {
  const name = relativePath.split('/').pop() ?? relativePath;
  const f = new File([content], name);
  Object.defineProperty(f, 'webkitRelativePath', { value: relativePath, configurable: true });
  return f;
}

describe('importFolder: generic auto matching', () => {
  it('numerically orders tracks (10 after 2, not lexicographically)', async () => {
    const album = await importFolder([
      file('Album/10 - Artist - Ten.mp3'),
      file('Album/2 - Artist - Two.mp3'),
    ]);
    expect(album.tracks.map((t) => t.number)).toEqual([2, 10]);
    expect(album.tracks[0].title).toBe('Two');
    expect(album.tracks[1].title).toBe('Ten');
  });

  it('preserves title qualifiers beyond the first artist/title split', async () => {
    const album = await importFolder([file('Album/01 - Artist - Title (Live Extended).mp3')]);
    expect(album.tracks[0]).toMatchObject({ artist: 'Artist', title: 'Title (Live Extended)' });
  });

  it('pairs audio, video, cover, and shared/per-version subtitles by matching stem', async () => {
    const stem = '01 - Artist - Title';
    const album = await importFolder([
      file(`Album/${stem}.mp3`),
      file(`Album/${stem}.mp4`),
      file(`Album/${stem}.jpg`),
      file(`Album/${stem}.en.srt`, '1\n00:00:01,000 --> 00:00:02,000\nshared lyric\n'),
      file(`Album/${stem}.audio.commentary.srt`, '1\n00:00:01,000 --> 00:00:02,000\naudio commentary\n'),
    ]);
    expect(album.tracks).toHaveLength(1);
    const track = album.tracks[0];
    expect(track.audio?.path).toBe(`${stem}.mp3`);
    expect(track.video?.path).toBe(`${stem}.mp4`);
    expect(track.cover?.path).toBe(`${stem}.jpg`);
    // Shared subtitle fills both audio and video lyrics since no explicit per-version file exists.
    expect(track.audioLyrics?.path).toBe(`${stem}.en.srt`);
    expect(track.videoLyrics?.path).toBe(`${stem}.en.srt`);
    // Explicit audio commentary applies only to audio; video commentary stays unset.
    expect(track.audioCommentary?.path).toBe(`${stem}.audio.commentary.srt`);
    expect(track.videoCommentary).toBeUndefined();
  });

  it('explicit per-version subtitles win over a shared candidate', async () => {
    const stem = '01 - Artist - Title';
    const album = await importFolder([
      file(`Album/${stem}.mp3`),
      file(`Album/${stem}.mp4`),
      file(`Album/${stem}.en.srt`),
      file(`Album/${stem}.audio.en.srt`),
    ]);
    const track = album.tracks[0];
    expect(track.audioLyrics?.path).toBe(`${stem}.audio.en.srt`);
    expect(track.videoLyrics?.path).toBe(`${stem}.en.srt`);
  });

  it('defaults switchPolicy to restart even when both audio and video are present', async () => {
    const stem = '01 - Artist - Title';
    const album = await importFolder([file(`Album/${stem}.mp3`), file(`Album/${stem}.mp4`)]);
    expect(album.tracks[0].switchPolicy).toBe('restart');
    const audioOnly = await importFolder([file('Album/02 - Artist - Solo.mp3')]);
    expect(audioOnly.tracks[0].switchPolicy).toBe('restart');
  });

  it('excludes hidden path components, node_modules, and backup files/dirs, and reports them as ignored', async () => {
    const album = await importFolder([
      file('Album/01 - Artist - Title.mp3'),
      file('Album/.DS_Store'),
      file('Album/.git/config'),
      file('Album/node_modules/pkg/index.js'),
      file('Album/backups/old.mp3'),
      file('Album/01 - Artist - Title.mp3~'),
    ]);
    expect(album.tracks).toHaveLength(1);
    expect(album.warnings.some((w) => /hidden, node_modules, or backup/.test(w))).toBe(true);
    expect(album.ignored).toContain('.DS_Store');
    expect(album.ignored).toContain('.git/config');
    expect(album.ignored).toContain('node_modules/pkg/index.js');
    expect(album.ignored).toContain('backups/old.mp3');
    expect(album.ignored).toContain('01 - Artist - Title.mp3~');
  });

  it('ignores nested media by default and warns, while still auto-matching root-level media', async () => {
    const album = await importFolder([
      file('Album/01 - Artist - Title.mp3'),
      file('Album/Bonus/02 - Artist - Nested.mp3'),
    ]);
    expect(album.tracks).toHaveLength(1);
    expect(album.tracks[0].audio?.path).toBe('01 - Artist - Title.mp3');
    expect(album.warnings.some((w) => /nested media file/.test(w))).toBe(true);
    expect(album.ignored).toContain('Bonus/02 - Artist - Nested.mp3');
  });

  it('rejects duplicate same-stem media candidates instead of silently choosing one', async () => {
    await expect(
      importFolder([file('Album/01 - Artist - Title.mp3'), file('Album/01 - Artist - Title.flac')]),
    ).rejects.toThrow(/Duplicate audio candidates/);
  });

  it('rejects ambiguous ungoverned subtitle candidates instead of guessing', async () => {
    const stem = 'Album/01 - Artist - Title';
    await expect(
      importFolder([file(`${stem}.mp3`), file(`${stem}.en.srt`), file(`${stem}.fr.srt`)]),
    ).rejects.toThrow(/Ambiguous shared lyrics subtitles/);

    await expect(
      importFolder([
        file(`${stem}.mp3`),
        file(`${stem}.audio.en.srt`),
        file(`${stem}.audio.fr.srt`),
      ]),
    ).rejects.toThrow(/Ambiguous audio lyrics subtitles/);
  });

  it('produces a stable deterministic id from number and stem', async () => {
    const a = await importFolder([file('Album/01 - Artist - Title.mp3')]);
    const b = await importFolder([file('Album/01 - Artist - Title.mp3')]);
    expect(a.tracks[0].id).toBe(b.tracks[0].id);
    expect(a.tracks[0].id).toMatch(/^t1-[0-9a-f]{8}$/);
  });

  it('uses the selected folder name as the album title', async () => {
    const album = await importFolder([file('My Album/01 - Artist - Title.mp3')]);
    expect(album.title).toBe('My Album');
  });

  it('handles a single plain File without mistaking its own filename for a folder root', async () => {
    const album = await importFolder([new File([''], '01 - Artist - Song.mp3')]);
    expect(album.tracks).toHaveLength(1);
    expect(album.tracks[0].audio?.path).toBe('01 - Artist - Song.mp3');
  });

  it('rejects files that collide once Unicode-normalized instead of silently overwriting', async () => {
    await expect(
      importFolder([
        file('Album/01 - Artist - Café.mp3'),
        file('Album/01 - Artist - Café.mp3'),
      ]),
    ).rejects.toThrow(/collid|same path/i);
  });

  it('treats a bare "audio"/"video" subtitle suffix as an explicit per-version match, not a language', async () => {
    const stem = '01 - Artist - Song';
    const album = await importFolder([
      file(`Album/${stem}.mp3`),
      file(`Album/${stem}.mp4`),
      file(`Album/${stem}.audio.srt`),
      file(`Album/${stem}.video.srt`),
    ]);
    expect(album.tracks[0].audioLyrics?.path).toBe(`${stem}.audio.srt`);
    expect(album.tracks[0].videoLyrics?.path).toBe(`${stem}.video.srt`);
  });
});

describe('importFolder: quixmix-import.json manifest', () => {
  function manifest(json: unknown) {
    return file('Album/quixmix-import.json', JSON.stringify(json));
  }

  it('overrides auto pairing using explicit relative paths', async () => {
    const album = await importFolder([
      manifest({
        version: 1,
        title: 'Manifest Album',
        tracks: [
          {
            number: 1,
            title: 'Custom Title',
            artist: 'Custom Artist',
            audio: 'oddly-named-file.mp3',
            audioLyrics: 'subs/nested.en.srt',
          },
        ],
      }),
      file('Album/oddly-named-file.mp3'),
      file('Album/subs/nested.en.srt'),
    ]);
    expect(album.title).toBe('Manifest Album');
    expect(album.tracks).toHaveLength(1);
    expect(album.tracks[0]).toMatchObject({ title: 'Custom Title', artist: 'Custom Artist', switchPolicy: 'restart' });
    expect(album.tracks[0].audio?.path).toBe('oddly-named-file.mp3');
    // Manifest can target a nested subtitle directory while media stays at the root.
    expect(album.tracks[0].audioLyrics?.path).toBe('subs/nested.en.srt');
  });

  it('reports files not referenced by the manifest as ignored', async () => {
    const album = await importFolder([
      manifest({
        version: 1,
        title: 'Manifest Album',
        tracks: [{ number: 1, title: 'T', artist: 'A', audio: 'track.mp3' }],
      }),
      file('Album/track.mp3'),
      file('Album/extra-notes.txt'),
    ]);
    expect(album.ignored).toContain('extra-notes.txt');
    expect(album.warnings.some((w) => /not referenced by the manifest/.test(w))).toBe(true);
  });

  it('throws when a referenced file is missing', async () => {
    await expect(
      importFolder([
        manifest({
          version: 1,
          title: 'Manifest Album',
          tracks: [{ number: 1, title: 'T', artist: 'A', audio: 'missing.mp3' }],
        }),
      ]),
    ).rejects.toThrow(/missing file/);
  });

  it.each([
    ['absolute path', '/etc/passwd.mp3'],
    ['traversal', '../outside.mp3'],
    ['encoded traversal', '%2e%2e/outside.mp3'],
    ['backslash', 'dir\\file.mp3'],
    ['empty segment', 'dir//file.mp3'],
  ])('rejects unsafe manifest path: %s', async (_label, badPath) => {
    await expect(
      importFolder([
        manifest({
          version: 1,
          title: 'Manifest Album',
          tracks: [{ number: 1, title: 'T', artist: 'A', audio: badPath }],
        }),
      ]),
    ).rejects.toThrow();
  });

  it('rejects a manifest track with an extension mismatched to its field', async () => {
    await expect(
      importFolder([
        manifest({
          version: 1,
          title: 'Manifest Album',
          tracks: [{ number: 1, title: 'T', artist: 'A', audio: 'track.txt' }],
        }),
        file('Album/track.txt'),
      ]),
    ).rejects.toThrow(/unexpected extension/);
  });

  it('rejects duplicate track numbers', async () => {
    await expect(
      importFolder([
        manifest({
          version: 1,
          title: 'Manifest Album',
          tracks: [
            { number: 1, title: 'A', artist: 'A', audio: 'a.mp3' },
            { number: 1, title: 'B', artist: 'B', audio: 'b.mp3' },
          ],
        }),
        file('Album/a.mp3'),
        file('Album/b.mp3'),
      ]),
    ).rejects.toThrow(/Duplicate manifest track number/);
  });

  it('requires at least one of audio or video per track', async () => {
    await expect(
      importFolder([
        manifest({
          version: 1,
          title: 'Manifest Album',
          tracks: [{ number: 1, title: 'T', artist: 'A', cover: 'cover.jpg' }],
        }),
        file('Album/cover.jpg'),
      ]),
    ).rejects.toThrow(/must reference audio or video/);
  });

  it('honors an explicit aligned switchPolicy', async () => {
    const album = await importFolder([
      manifest({
        version: 1,
        title: 'Manifest Album',
        tracks: [{ number: 1, title: 'T', artist: 'A', audio: 'a.mp3', video: 'a.mp4', switchPolicy: 'aligned' }],
      }),
      file('Album/a.mp3'),
      file('Album/a.mp4'),
    ]);
    expect(album.tracks[0].switchPolicy).toBe('aligned');
  });
});

describe('importFolder: limits', () => {
  it('rejects selections over the file count limit', async () => {
    const files = Array.from({ length: 10001 }, (_, i) => file(`Album/file-${i}.mp3`));
    await expect(importFolder(files)).rejects.toThrow(/Too many files/);
  });
});

describe('subtitleToVtt', () => {
  it('converts a numbered multi-line SRT into a BOM/CRLF VTT with matching timing and text', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:04,500\r\nfirst\r\nline\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,000\r\nsecond\r\n';
    const vtt = subtitleToVtt(srt, 'captions.srt');
    expect(vtt.startsWith('﻿WEBVTT\r\n')).toBe(true);
    expect(vtt).toContain('1\r\n00:00:01.000 --> 00:00:04.500\r\nfirst\r\nline');
    expect(vtt).toContain('2\r\n00:00:05.000 --> 00:00:06.000\r\nsecond');
  });

  it('assigns sequential identifiers when the SRT omits cue numbers', () => {
    const srt = '00:00:01,000 --> 00:00:02,000\nonly cue\n';
    const vtt = subtitleToVtt(srt, 'captions.srt');
    expect(vtt).toContain('1\r\n00:00:01.000 --> 00:00:02.000\r\nonly cue');
  });

  it('does not rewrite text or apply any timing offset', () => {
    const srt = '1\n00:01:02,003 --> 00:01:05,006\nunchanged text\n';
    const vtt = subtitleToVtt(srt, 'captions.srt');
    expect(vtt).toContain('00:01:02.003 --> 00:01:05.006\r\nunchanged text');
  });

  it('passes a valid .vtt file through unchanged', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello\n';
    expect(subtitleToVtt(vtt, 'captions.vtt')).toBe(vtt);
  });

  it.each([
    ['malformed timestamp', '1\n00:00:01,000 -> 00:00:02,000\ntext\n'],
    ['out-of-range minutes', '1\n00:60:00,000 --> 00:60:01,000\ntext\n'],
    ['end before start', '1\n00:00:02,000 --> 00:00:01,000\ntext\n'],
    ['missing text', '1\n00:00:01,000 --> 00:00:02,000\n'],
  ])('rejects %s', (_label, srt) => {
    expect(() => subtitleToVtt(srt, 'captions.srt')).toThrow();
  });

  it('rejects an invalid .vtt input via parseVtt', () => {
    expect(() => subtitleToVtt('not a vtt file', 'captions.vtt')).toThrow(/WEBVTT/);
  });

  it('rejects an unsupported subtitle extension', () => {
    expect(() => subtitleToVtt('anything', 'captions.ass')).toThrow(/Unsupported subtitle format/);
  });

  it('rejects an SRT that exceeds the cue limit via parseVtt reuse', () => {
    // Build valid, strictly increasing timestamps to isolate the count limit from ordering errors.
    const fmt = (s: number) =>
      `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
    const cues = Array.from({ length: 5001 }, (_, i) => `${i + 1}\n${fmt(i)} --> ${fmt(i + 1)}\ncue ${i}`);
    const srt = cues.join('\n\n');
    expect(() => subtitleToVtt(srt, 'captions.srt')).toThrow(/at most 5000 cues/);
  });
});
