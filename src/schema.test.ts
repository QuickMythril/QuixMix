import { describe, expect, it } from 'vitest';
import { parsePlaylist, parseVtt } from './schema';

function baseTrack() {
  return {
    id: 'one',
    title: 'Song',
    artist: 'Artist',
    versions: {
      audio: {
        resource: { service: 'AUDIO', name: 'Publisher', identifier: 'recording' },
      },
    },
  };
}

function manifest(tracks: unknown[] = [baseTrack()]) {
  return { kind: 'qortium-music-playlist', schemaVersion: 1, title: 'List', tracks };
}

describe('parsePlaylist', () => {
  it('parses JSON strings, infers defaults, and sanitizes the result', () => {
    const parsed = parsePlaylist(JSON.stringify(manifest()));
    expect(parsed.tracks[0]).toMatchObject({ defaultVersion: 'audio', switchPolicy: 'restart' });
    expect(parsed.tracks[0].versions.audio?.resource.service).toBe('AUDIO');
  });

  it('infers video when it is the only version', () => {
    const item = {
      ...baseTrack(),
      versions: {
      video: { resource: { service: 'VIDEO', name: 'Publisher', identifier: 'video' } },
      },
    };
    expect(parsePlaylist(manifest([item])).tracks[0].defaultVersion).toBe('video');
  });

  it('allows repeated media references but rejects repeated track IDs', () => {
    const first = baseTrack();
    const second = { ...baseTrack(), id: 'two' };
    expect(parsePlaylist(manifest([first, second])).tracks).toHaveLength(2);
    expect(() => parsePlaylist(manifest([first, baseTrack()]))).toThrow(/duplicate track id/);
  });

  it.each([
    ['bad kind', { ...manifest(), kind: 'playlist' }, /playlist\.kind/],
    ['bad version', { ...manifest(), schemaVersion: 2 }, /schemaVersion/],
    ['missing versions', manifest([{ ...baseTrack(), versions: {} }]), /must contain audio or video/],
    [
      'missing default',
      manifest([{ ...baseTrack(), defaultVersion: 'video' }]),
      /references missing video version/,
    ],
    [
      'wrong media service',
      manifest([
        {
          ...baseTrack(),
          versions: {
            audio: { resource: { service: 'VIDEO', name: 'Publisher', identifier: 'recording' } },
          },
        },
      ]),
      /service: must be AUDIO/,
    ],
    [
      'wrong cover service',
      manifest([
        {
          ...baseTrack(),
          cover: { service: 'FILE', name: 'Publisher', identifier: 'cover' },
        },
      ]),
      /service: must be IMAGE/,
    ],
    [
      'wrong text format',
      manifest([
        {
          ...baseTrack(),
          lyrics: {
            service: 'FILE',
            name: 'Publisher',
            identifier: 'lyrics',
            format: 'srt',
          },
        },
      ]),
      /format: must be vtt/,
    ],
  ])('rejects %s', (_label, value, error) => {
    expect(() => parsePlaylist(value)).toThrow(error as RegExp);
  });

  it('enforces UTF-8 resource limits, safe paths, and bounded offsets', () => {
    const tooLongName = 'é'.repeat(21);
    const badName = manifest([
      {
        ...baseTrack(),
        versions: {
          audio: { resource: { service: 'AUDIO', name: tooLongName, identifier: 'recording' } },
        },
      },
    ]);
    expect(() => parsePlaylist(badName)).toThrow(/40 UTF-8 bytes/);

    for (const path of ['/root/file.mp3', '../file.mp3', 'dir//file.mp3', 'dir/%2e%2e/file.mp3']) {
      const badPath = manifest([
        {
          ...baseTrack(),
          versions: {
            audio: {
              resource: { service: 'AUDIO', name: 'Publisher', identifier: 'recording', path },
            },
          },
        },
      ]);
      expect(() => parsePlaylist(badPath), path).toThrow(/path/);
    }

    const badOffset = manifest([
      { ...baseTrack(), versions: { audio: { ...baseTrack().versions.audio, timelineOffsetMs: 1.5 } } },
    ]);
    expect(() => parsePlaylist(badOffset)).toThrow(/finite integer/);
  });

  it('supports inherited, overridden, and disabled timed text', () => {
    const ref = {
      service: 'FILE',
      name: 'Publisher',
      identifier: 'lyrics',
      format: 'vtt',
      language: 'en',
      offsetMs: -250,
    };
    const value = manifest([
      {
        ...baseTrack(),
        lyrics: ref,
        versions: {
          audio: { ...baseTrack().versions.audio, lyrics: null, commentary: ref },
        },
      },
    ]);
    const parsed = parsePlaylist(value).tracks[0];
    expect(parsed.lyrics?.offsetMs).toBe(-250);
    expect(parsed.versions.audio?.lyrics).toBeNull();
    expect(parsed.versions.audio?.commentary?.format).toBe('vtt');
  });

  it('rejects oversized manifests and track lists', () => {
    expect(() => parsePlaylist(`${JSON.stringify(manifest())}${' '.repeat(1024 * 1024)}`)).toThrow(
      /at most 1048576/,
    );
    expect(() => parsePlaylist(manifest(Array.from({ length: 2001 }, baseTrack)))).toThrow(
      /at most 2000 tracks/,
    );
  });

  it('reports malformed JSON clearly', () => {
    expect(() => parsePlaylist('{ nope')).toThrow(/invalid JSON/);
  });
});

describe('parseVtt', () => {
  it('parses identifiers, multiline text, notes, CRLF, and overlapping cues', () => {
    const cues = parseVtt(
      '\uFEFFWEBVTT\r\n\r\nNOTE this is ignored\r\nacross lines\r\n\r\nverse\r\n00:00:01.000 --> 00:00:03.000\r\nfirst\r\nline\r\n\r\n00:02.500 --> 00:04.000\r\noverlap\r\n',
    );
    expect(cues).toEqual([
      { id: 'verse', start: 1, end: 3, text: 'first\nline' },
      { id: 'cue-2', start: 2.5, end: 4, text: 'overlap' },
    ]);
  });

  it('parses hour timestamps', () => {
    expect(parseVtt('WEBVTT\n\n01:02:03.004 --> 01:02:04.005\ntext\n')[0]).toMatchObject({
      start: 3723.004,
      end: 3724.005,
    });
  });

  it.each([
    ['missing header', '00:00.000 --> 00:01.000\ntext', /missing WEBVTT header/],
    ['cue settings', 'WEBVTT\n\n00:00.000 --> 00:01.000 line:0\ntext', /without cue settings/],
    ['markup', 'WEBVTT\n\n00:00.000 --> 00:01.000\n<b>text<\/b>', /markup is not supported/],
    ['style', 'WEBVTT\n\nSTYLE\n::cue { color: red; }', /STYLE blocks are not supported/],
    ['bad range', 'WEBVTT\n\n00:02.000 --> 00:01.000\ntext', /end must be after/],
    ['bad timestamp', 'WEBVTT\n\n00:60.000 --> 01:01.000\ntext', /below 60/],
    ['empty text', 'WEBVTT\n\n00:00.000 --> 00:01.000\n', /must not be empty/],
    ['blank text', 'WEBVTT\n\n00:00.000 --> 00:01.000\n   \n', /must not be blank/],
  ])('rejects %s', (_label, value, error) => {
    expect(() => parseVtt(value)).toThrow(error as RegExp);
  });
});
