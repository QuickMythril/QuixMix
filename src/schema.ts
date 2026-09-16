import type {
  Cue,
  MediaKind,
  MediaVersion,
  Playlist,
  ResourceRef,
  ResourceService,
  TextRef,
  Track,
} from './model';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_TRACKS = 2000;
const MAX_NAME_BYTES = 40;
const MAX_IDENTIFIER_BYTES = 64;
const MAX_PATH_BYTES = 1024;
const MAX_OFFSET_MS = 24 * 60 * 60 * 1000;
const MAX_VTT_BYTES = 1024 * 1024;
const MAX_CUES = 5000;
const MAX_CUE_TEXT_BYTES = 16 * 1024;
const MAX_CUE_ID_BYTES = 256;
const MAX_CUE_TIME_SECONDS = 7 * 24 * 60 * 60;

const utf8 = new TextEncoder();

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  path: string,
  maxBytes: number,
  options: { trim?: boolean } = { trim: true },
): string {
  if (typeof value !== 'string') fail(path, 'must be a string');
  const result = options.trim === false ? value : value.trim();
  if (result.length === 0) fail(path, 'must not be empty');
  if (/\p{Cc}/u.test(result)) fail(path, 'must not contain control characters');
  const byteLength = utf8.encode(result).byteLength;
  if (byteLength > maxBytes) fail(path, `must be at most ${maxBytes} UTF-8 bytes`);
  return result;
}

function optionalString(value: unknown, path: string, maxBytes: number): string | undefined {
  return value === undefined ? undefined : stringValue(value, path, maxBytes);
}

function offset(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail(path, 'must be a finite integer number of milliseconds');
  }
  if (Math.abs(value) > MAX_OFFSET_MS) {
    fail(path, `must be between -${MAX_OFFSET_MS} and ${MAX_OFFSET_MS} milliseconds`);
  }
  return value;
}

function safePath(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  const result = stringValue(value, path, MAX_PATH_BYTES, { trim: false });
  if (result.trim().length === 0) fail(path, 'must not be blank');
  if (result.startsWith('/') || result.endsWith('/') || result.includes('\\')) {
    fail(path, 'must be a relative slash-separated path');
  }
  if (/[?#]/.test(result)) fail(path, 'must not contain a query or fragment');

  for (const segment of result.split('/')) {
    if (!segment) fail(path, 'must not contain empty path segments');
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      fail(path, 'contains invalid percent encoding');
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      /\p{Cc}/u.test(decoded)
    ) {
      fail(path, 'contains an unsafe path segment');
    }
  }
  return result;
}

function resource(
  value: unknown,
  path: string,
  expectedService: ResourceService,
): ResourceRef {
  const source = record(value, path);
  if (source.service !== expectedService) {
    fail(`${path}.service`, `must be ${expectedService}`);
  }
  const result: ResourceRef = {
    service: expectedService,
    name: stringValue(source.name, `${path}.name`, MAX_NAME_BYTES),
    identifier: stringValue(source.identifier, `${path}.identifier`, MAX_IDENTIFIER_BYTES),
  };
  if (source.path !== undefined && expectedService !== 'AUDIO' && expectedService !== 'VIDEO') {
    fail(`${path}.path`, 'is only supported for AUDIO or VIDEO resources');
  }
  const parsedPath = safePath(source.path, `${path}.path`);
  if (parsedPath !== undefined) result.path = parsedPath;
  return result;
}

function textRef(value: unknown, path: string): TextRef {
  const source = record(value, path);
  const base = resource(source, path, 'FILE');
  if (source.format !== 'vtt') fail(`${path}.format`, 'must be vtt');
  const result: TextRef = { ...base, service: 'FILE', format: 'vtt' };
  const language = optionalString(source.language, `${path}.language`, 35);
  const parsedOffset = offset(source.offsetMs, `${path}.offsetMs`);
  if (language !== undefined) result.language = language;
  if (parsedOffset !== undefined) result.offsetMs = parsedOffset;
  return result;
}

function version(value: unknown, path: string, kind: MediaKind): MediaVersion {
  const source = record(value, path);
  const result: MediaVersion = {
    resource: resource(source.resource, `${path}.resource`, kind === 'audio' ? 'AUDIO' : 'VIDEO'),
  };
  const timelineOffsetMs = offset(source.timelineOffsetMs, `${path}.timelineOffsetMs`);
  if (timelineOffsetMs !== undefined) result.timelineOffsetMs = timelineOffsetMs;
  for (const role of ['lyrics', 'commentary'] as const) {
    if (source[role] === null) result[role] = null;
    else if (source[role] !== undefined) result[role] = textRef(source[role], `${path}.${role}`);
  }
  return result;
}

function track(value: unknown, path: string): Track {
  const source = record(value, path);
  const versionsSource = record(source.versions, `${path}.versions`);
  const versions: Track['versions'] = {};
  if (versionsSource.audio !== undefined) {
    versions.audio = version(versionsSource.audio, `${path}.versions.audio`, 'audio');
  }
  if (versionsSource.video !== undefined) {
    versions.video = version(versionsSource.video, `${path}.versions.video`, 'video');
  }
  if (!versions.audio && !versions.video) fail(`${path}.versions`, 'must contain audio or video');

  let defaultVersion: MediaKind;
  if (source.defaultVersion === undefined) defaultVersion = versions.audio ? 'audio' : 'video';
  else if (source.defaultVersion === 'audio' || source.defaultVersion === 'video') {
    defaultVersion = source.defaultVersion;
  } else fail(`${path}.defaultVersion`, 'must be audio or video');
  if (!versions[defaultVersion]) {
    fail(`${path}.defaultVersion`, `references missing ${defaultVersion} version`);
  }

  let switchPolicy: Track['switchPolicy'];
  if (source.switchPolicy === undefined) switchPolicy = 'restart';
  else if (source.switchPolicy === 'aligned' || source.switchPolicy === 'restart') {
    switchPolicy = source.switchPolicy;
  } else fail(`${path}.switchPolicy`, 'must be aligned or restart');

  const result: Track = {
    id: stringValue(source.id, `${path}.id`, MAX_IDENTIFIER_BYTES),
    title: stringValue(source.title, `${path}.title`, 512),
    artist: stringValue(source.artist, `${path}.artist`, 512),
    defaultVersion,
    switchPolicy,
    versions,
  };
  if (source.cover !== undefined) result.cover = resource(source.cover, `${path}.cover`, 'IMAGE');
  if (source.lyrics !== undefined) result.lyrics = textRef(source.lyrics, `${path}.lyrics`);
  if (source.commentary !== undefined) {
    result.commentary = textRef(source.commentary, `${path}.commentary`);
  }
  return result;
}

function manifestByteLength(value: unknown): number {
  if (typeof value === 'string') return utf8.encode(value).byteLength;
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail('playlist', 'must be a JSON object');
    return utf8.encode(encoded).byteLength;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('playlist:')) throw error;
    fail('playlist', 'must be JSON-serializable');
  }
}

export function parsePlaylist(value: unknown): Playlist {
  if (manifestByteLength(value) > MAX_MANIFEST_BYTES) {
    fail('playlist', `must be at most ${MAX_MANIFEST_BYTES} UTF-8 bytes`);
  }

  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown JSON error';
      fail('playlist', `invalid JSON (${detail})`);
    }
  }
  const source = record(parsed, 'playlist');
  if (source.kind !== 'qortium-music-playlist') {
    fail('playlist.kind', 'must be qortium-music-playlist');
  }
  if (source.schemaVersion !== 1) fail('playlist.schemaVersion', 'must be 1');
  if (!Array.isArray(source.tracks)) fail('playlist.tracks', 'must be an array');
  if (source.tracks.length > MAX_TRACKS) {
    fail('playlist.tracks', `must contain at most ${MAX_TRACKS} tracks`);
  }

  const tracks = source.tracks.map((item, index) => track(item, `playlist.tracks[${index}]`));
  const ids = new Set<string>();
  for (let index = 0; index < tracks.length; index += 1) {
    const id = tracks[index].id;
    if (ids.has(id)) fail(`playlist.tracks[${index}].id`, `duplicate track id ${JSON.stringify(id)}`);
    ids.add(id);
  }

  return {
    kind: 'qortium-music-playlist',
    schemaVersion: 1,
    title: stringValue(source.title, 'playlist.title', 512),
    tracks,
  };
}

function parseTimestamp(value: string, path: string): number {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (!match) fail(path, 'timestamp must be mm:ss.mmm or hh:mm:ss.mmm');
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  if (minutes >= 60 || seconds >= 60) fail(path, 'minutes and seconds must be below 60');
  const total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  if (total > MAX_CUE_TIME_SECONDS) fail(path, 'timestamp exceeds the seven-day limit');
  return total;
}

export function parseVtt(text: string): Cue[] {
  if (typeof text !== 'string') fail('VTT', 'must be a string');
  if (utf8.encode(text).byteLength > MAX_VTT_BYTES) {
    fail('VTT', `must be at most ${MAX_VTT_BYTES} UTF-8 bytes`);
  }
  if (text.includes('\0')) fail('VTT', 'must not contain NUL characters');

  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0] ?? '')) fail('VTT line 1', 'missing WEBVTT header');

  if (lines.length > 1 && lines[1] !== '') {
    fail('VTT line 2', 'the WEBVTT header must be followed by a blank line');
  }
  let lineIndex = lines.length > 1 ? 2 : 1;
  const cues: Cue[] = [];

  while (lineIndex < lines.length) {
    while (lineIndex < lines.length && lines[lineIndex] === '') lineIndex += 1;
    if (lineIndex >= lines.length) break;
    const blockStart = lineIndex;
    const first = lines[lineIndex];

    if (/^NOTE(?:[ \t]|$)/.test(first)) {
      while (lineIndex < lines.length && lines[lineIndex] !== '') lineIndex += 1;
      continue;
    }
    if (/^(STYLE|REGION)(?:[ \t]|$)/.test(first)) {
      fail(`VTT line ${blockStart + 1}`, `${first.split(/[ \t]/, 1)[0]} blocks are not supported`);
    }

    let identifier: string | undefined;
    let timingLine = first;
    if (!first.includes('-->')) {
      identifier = stringValue(first, `VTT line ${lineIndex + 1} cue identifier`, MAX_CUE_ID_BYTES, {
        trim: false,
      });
      if (identifier.trim().length === 0) fail(`VTT line ${lineIndex + 1}`, 'cue identifier must not be blank');
      lineIndex += 1;
      timingLine = lines[lineIndex] ?? '';
    }

    const timingMatch = /^(\S+) --> (\S+)$/.exec(timingLine);
    if (!timingMatch) {
      fail(`VTT line ${lineIndex + 1}`, 'expected plain cue timing without cue settings');
    }
    const start = parseTimestamp(timingMatch[1], `VTT line ${lineIndex + 1} start`);
    const end = parseTimestamp(timingMatch[2], `VTT line ${lineIndex + 1} end`);
    if (end <= start) fail(`VTT line ${lineIndex + 1}`, 'cue end must be after its start');
    lineIndex += 1;

    const textLines: string[] = [];
    while (lineIndex < lines.length && lines[lineIndex] !== '') {
      const cueLine = lines[lineIndex];
      if (cueLine.includes('-->')) fail(`VTT line ${lineIndex + 1}`, 'cue text must not contain -->');
      if (/[<>]/.test(cueLine)) {
        fail(`VTT line ${lineIndex + 1}`, 'cue markup is not supported; use plain text');
      }
      if (/\p{Cc}/u.test(cueLine)) fail(`VTT line ${lineIndex + 1}`, 'cue text contains control characters');
      textLines.push(cueLine);
      lineIndex += 1;
    }
    if (textLines.length === 0) fail(`VTT line ${blockStart + 1}`, 'cue text must not be empty');
    const cueText = textLines.join('\n');
    if (cueText.trim().length === 0) fail(`VTT line ${blockStart + 1}`, 'cue text must not be blank');
    if (utf8.encode(cueText).byteLength > MAX_CUE_TEXT_BYTES) {
      fail(`VTT line ${blockStart + 1}`, `cue text exceeds ${MAX_CUE_TEXT_BYTES} UTF-8 bytes`);
    }
    cues.push({ id: identifier ?? `cue-${cues.length + 1}`, start, end, text: cueText });
    if (cues.length > MAX_CUES) fail('VTT', `must contain at most ${MAX_CUES} cues`);
  }

  return cues;
}
