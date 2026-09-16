import { parseVtt } from './schema';

export interface ImportAsset {
  path: string;
  file: File;
}

export interface ImportTrack {
  id: string;
  number: number;
  title: string;
  artist: string;
  audio?: ImportAsset;
  video?: ImportAsset;
  cover?: ImportAsset;
  audioLyrics?: ImportAsset;
  videoLyrics?: ImportAsset;
  audioCommentary?: ImportAsset;
  videoCommentary?: ImportAsset;
  switchPolicy: 'aligned' | 'restart';
}

export interface ImportedAlbum {
  title: string;
  tracks: ImportTrack[];
  warnings: string[];
  ignored: string[];
}

const MAX_FILES = 10000;
const MAX_TRACKS = 2000;
const MAX_TEXT_BYTES = 1024 * 1024;

const AUDIO_EXT = new Set(['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'aac']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const SUBTITLE_EXT = new Set(['srt', 'vtt']);

const MANIFEST_NAME = 'quixmix-import.json';
const BACKUP_DIR = /^backups?$/i;

const utf8 = new TextEncoder();

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function filePath(file: File): string {
  const raw = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath;
  return raw && raw.length > 0 ? raw : file.name;
}

function stripRoot(files: File[]): { root: string; entries: { path: string; file: File }[] } {
  const rawPaths = files.map(filePath);
  // Only paths with a real directory component (from webkitdirectory selection) carry a
  // selected-folder root; a lone File with no webkitRelativePath must not have its own
  // filename mistaken for that root and stripped away.
  const nested = rawPaths.filter((path) => pathSegments(path).length > 1);
  const first = nested.length > 0 ? pathSegments(nested[0])[0] : '';
  const shareRoot = first !== '' && nested.every((path) => pathSegments(path)[0] === first);
  const root = shareRoot ? first : '';
  const entries = files.map((file, index) => {
    const parts = pathSegments(rawPaths[index]);
    const rel = shareRoot && parts.length > 1 && parts[0] === first ? parts.slice(1) : parts;
    return { path: rel.join('/'), file };
  });
  return { root, entries };
}

function isExcludedPath(relPath: string): boolean {
  const parts = relPath.split('/');
  return parts.some((part, index) => {
    if (part.startsWith('.')) return true;
    if (part === 'node_modules') return true;
    if (index < parts.length - 1 && BACKUP_DIR.test(part)) return true;
    if (index === parts.length - 1 && (part.endsWith('~') || /\.bak$/i.test(part))) return true;
    return false;
  });
}

function extOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function stemOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

function safeRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (value.startsWith('/') || value.endsWith('/') || value.includes('\\')) {
    throw new Error(`${label} must be a relative slash-separated path.`);
  }
  if (/[?#]/.test(value)) throw new Error(`${label} must not contain a query or fragment.`);
  for (const segment of value.split('/')) {
    if (!segment) throw new Error(`${label} must not contain empty path segments.`);
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`${label} contains invalid percent encoding.`);
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      throw new Error(`${label} contains an unsafe path segment.`);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Deterministic ids and filename parsing
// ---------------------------------------------------------------------------

function hashStem(stem: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(stem)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function trackId(number: number, stem: string): string {
  return `t${number}-${hashStem(stem)}`;
}

function parseStem(stem: string): { number: number | null; title: string; artist: string } {
  const match = /^0*(\d+)(?:\s*[-._]\s*|\s+)(.+)$/.exec(stem);
  if (!match) return { number: null, title: stem, artist: '' };
  const number = Number(match[1]);
  const rest = match[2];
  const sepIndex = rest.indexOf(' - ');
  if (sepIndex === -1) return { number, title: rest, artist: '' };
  return { number, title: rest.slice(sepIndex + 3), artist: rest.slice(0, sepIndex) };
}

// ---------------------------------------------------------------------------
// Subtitle suffix matching (generic auto pairing)
// ---------------------------------------------------------------------------

type SubtitleRole = 'lyrics' | 'commentary';
type SubtitleTarget = 'shared' | 'audio' | 'video';

const RESERVED_SUBTITLE_TOKENS = new Set(['audio', 'video', 'commentary']);

function isLangToken(token: string): boolean {
  if (RESERVED_SUBTITLE_TOKENS.has(token)) return false;
  return /^[a-z]{2,8}$/i.test(token);
}

function parseSubtitleSuffix(tokens: string[]): { role: SubtitleRole; target: SubtitleTarget } | null {
  if (tokens.length === 0) return { role: 'lyrics', target: 'shared' };
  if (tokens.length === 1) {
    const [token] = tokens;
    if (token === 'commentary') return { role: 'commentary', target: 'shared' };
    if (token === 'audio' || token === 'video') return { role: 'lyrics', target: token };
    if (isLangToken(token)) return { role: 'lyrics', target: 'shared' };
    return null;
  }
  if (tokens.length === 2) {
    const [first, second] = tokens;
    if ((first === 'audio' || first === 'video') && second === 'commentary') {
      return { role: 'commentary', target: first };
    }
    if ((first === 'audio' || first === 'video') && isLangToken(second)) {
      return { role: 'lyrics', target: first };
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// importFolder: generic auto matching
// ---------------------------------------------------------------------------

interface MediaGroup {
  audio?: string;
  video?: string;
  cover?: string;
}

function asset(fileMap: Map<string, File>, path: string | undefined): ImportAsset | undefined {
  if (!path) return undefined;
  const file = fileMap.get(path);
  if (!file) throw new Error(`Missing file for "${path}".`);
  return { path, file };
}

function importAuto(fileMap: Map<string, File>, ignored: string[], warnings: string[], root: string): ImportedAlbum {
  const rootLevel: string[] = [];
  const nested: string[] = [];
  for (const path of fileMap.keys()) (path.includes('/') ? nested : rootLevel).push(path);

  let nestedMediaCount = 0;
  for (const path of nested) {
    const ext = extOf(path);
    if (AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext) || IMAGE_EXT.has(ext)) nestedMediaCount += 1;
  }
  if (nestedMediaCount > 0) {
    warnings.push(
      `Ignored ${nestedMediaCount} nested media file(s); only root-level files are auto-matched. Provide a ${MANIFEST_NAME} manifest to include nested files.`,
    );
  }
  ignored.push(...nested);

  const mediaGroups = new Map<string, MediaGroup>();
  for (const path of rootLevel) {
    const ext = extOf(path);
    const kind: keyof MediaGroup | null = AUDIO_EXT.has(ext)
      ? 'audio'
      : VIDEO_EXT.has(ext)
        ? 'video'
        : IMAGE_EXT.has(ext)
          ? 'cover'
          : null;
    if (!kind) continue;
    const stem = stemOf(path).normalize('NFC');
    const group = mediaGroups.get(stem) ?? {};
    const existing = group[kind];
    if (existing !== undefined) {
      throw new Error(
        `Duplicate ${kind} candidates for "${stem}": "${existing}" and "${path}". Resolve with a ${MANIFEST_NAME} manifest.`,
      );
    }
    group[kind] = path;
    mediaGroups.set(stem, group);
  }

  const trackStems = [...mediaGroups.entries()]
    .filter(([, group]) => group.audio || group.video)
    .map(([stem]) => stem)
    .sort((a, b) => a.localeCompare(b));
  const stemsByLength = [...trackStems].sort((a, b) => b.length - a.length);

  const subtitleCandidates = new Map<string, Record<SubtitleRole, Record<SubtitleTarget, string[]>>>();
  const emptyTargets = (): Record<SubtitleTarget, string[]> => ({ shared: [], audio: [], video: [] });

  for (const path of rootLevel) {
    const ext = extOf(path);
    if (ext !== 'srt' && ext !== 'vtt') continue;
    const base = stemOf(path).normalize('NFC');
    const matchStem = stemsByLength.find((stem) => base === stem || base.startsWith(`${stem}.`));
    if (!matchStem) continue;
    const suffix = base === matchStem ? '' : base.slice(matchStem.length + 1);
    const parsed = parseSubtitleSuffix(suffix ? suffix.split('.') : []);
    if (!parsed) continue;
    const roles = subtitleCandidates.get(matchStem) ?? { lyrics: emptyTargets(), commentary: emptyTargets() };
    roles[parsed.role][parsed.target].push(path);
    subtitleCandidates.set(matchStem, roles);
  }

  function resolveSlot(stem: string, role: SubtitleRole, slot: 'audio' | 'video'): string | undefined {
    const roles = subtitleCandidates.get(stem);
    if (!roles) return undefined;
    const explicit = roles[role][slot];
    const shared = roles[role].shared;
    if (explicit.length > 1) {
      throw new Error(
        `Ambiguous ${slot} ${role} subtitles for "${stem}": ${explicit.join(', ')}. Resolve with a ${MANIFEST_NAME} manifest.`,
      );
    }
    if (shared.length > 1) {
      throw new Error(
        `Ambiguous shared ${role} subtitles for "${stem}": ${shared.join(', ')}. Resolve with a ${MANIFEST_NAME} manifest.`,
      );
    }
    return explicit[0] ?? shared[0];
  }

  let nextNumber = 1;
  for (const stem of trackStems) {
    const parsed = parseStem(stem);
    if (parsed.number !== null) nextNumber = Math.max(nextNumber, parsed.number + 1);
  }
  const numbered = new Map<string, number>();
  for (const stem of trackStems) {
    const parsed = parseStem(stem);
    numbered.set(stem, parsed.number ?? nextNumber++);
  }

  const orderedStems = [...trackStems].sort((a, b) => {
    const diff = numbered.get(a)! - numbered.get(b)!;
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const used = new Set<string>();
  const tracks: ImportTrack[] = orderedStems.map((stem) => {
    const parsedName = parseStem(stem);
    const number = numbered.get(stem)!;
    const group = mediaGroups.get(stem)!;
    const audioLyricsPath = group.audio ? resolveSlot(stem, 'lyrics', 'audio') : undefined;
    const videoLyricsPath = group.video ? resolveSlot(stem, 'lyrics', 'video') : undefined;
    const audioCommentaryPath = group.audio ? resolveSlot(stem, 'commentary', 'audio') : undefined;
    const videoCommentaryPath = group.video ? resolveSlot(stem, 'commentary', 'video') : undefined;
    for (const path of [
      group.audio,
      group.video,
      group.cover,
      audioLyricsPath,
      videoLyricsPath,
      audioCommentaryPath,
      videoCommentaryPath,
    ]) {
      if (path) used.add(path);
    }
    return {
      id: trackId(number, stem),
      number,
      title: parsedName.title,
      artist: parsedName.artist,
      audio: asset(fileMap, group.audio),
      video: asset(fileMap, group.video),
      cover: asset(fileMap, group.cover),
      audioLyrics: asset(fileMap, audioLyricsPath),
      videoLyrics: asset(fileMap, videoLyricsPath),
      audioCommentary: asset(fileMap, audioCommentaryPath),
      videoCommentary: asset(fileMap, videoCommentaryPath),
      switchPolicy: 'restart',
    };
  });

  if (tracks.length > MAX_TRACKS) throw new Error(`Import must contain at most ${MAX_TRACKS} tracks.`);

  ignored.push(...rootLevel.filter((path) => !used.has(path)));

  return { title: root || 'Imported Album', tracks, warnings, ignored: ignored.sort() };
}

// ---------------------------------------------------------------------------
// importFolder: manifest-driven matching
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function manifestString(value: unknown, label: string, maxBytes = 512): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  if (utf8.encode(value).byteLength > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  return value;
}

function manifestPathField(
  source: Record<string, unknown>,
  field: string,
  label: string,
  extensions: Set<string>,
): string | undefined {
  if (source[field] === undefined) return undefined;
  const path = safeRelativePath(source[field], label);
  if (!extensions.has(extOf(path))) throw new Error(`${label} has an unexpected extension: "${path}".`);
  return path;
}

interface ManifestTrackInput {
  number: number;
  title: string;
  artist: string;
  audio?: string;
  video?: string;
  cover?: string;
  audioLyrics?: string;
  videoLyrics?: string;
  audioCommentary?: string;
  videoCommentary?: string;
  switchPolicy: 'restart' | 'aligned';
}

function parseManifestTrack(value: unknown, path: string): ManifestTrackInput {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  if (typeof value.number !== 'number' || !Number.isInteger(value.number) || value.number <= 0) {
    throw new Error(`${path}.number must be a positive integer.`);
  }
  const title = manifestString(value.title, `${path}.title`);
  const artist = value.artist === undefined ? '' : manifestString(value.artist, `${path}.artist`);
  const audio = manifestPathField(value, 'audio', `${path}.audio`, AUDIO_EXT);
  const video = manifestPathField(value, 'video', `${path}.video`, VIDEO_EXT);
  if (!audio && !video) throw new Error(`${path} must reference audio or video.`);
  const cover = manifestPathField(value, 'cover', `${path}.cover`, IMAGE_EXT);
  const audioLyrics = manifestPathField(value, 'audioLyrics', `${path}.audioLyrics`, SUBTITLE_EXT);
  const videoLyrics = manifestPathField(value, 'videoLyrics', `${path}.videoLyrics`, SUBTITLE_EXT);
  const audioCommentary = manifestPathField(value, 'audioCommentary', `${path}.audioCommentary`, SUBTITLE_EXT);
  const videoCommentary = manifestPathField(value, 'videoCommentary', `${path}.videoCommentary`, SUBTITLE_EXT);
  let switchPolicy: 'restart' | 'aligned' = 'restart';
  if (value.switchPolicy !== undefined) {
    if (value.switchPolicy !== 'restart' && value.switchPolicy !== 'aligned') {
      throw new Error(`${path}.switchPolicy must be "restart" or "aligned".`);
    }
    switchPolicy = value.switchPolicy;
  }
  return {
    number: value.number,
    title,
    artist,
    audio,
    video,
    cover,
    audioLyrics,
    videoLyrics,
    audioCommentary,
    videoCommentary,
    switchPolicy,
  };
}

async function readBoundedText(file: File, label: string): Promise<string> {
  if (file.size > MAX_TEXT_BYTES) throw new Error(`${label} exceeds ${MAX_TEXT_BYTES} bytes.`);
  const text = await file.text();
  if (utf8.encode(text).byteLength > MAX_TEXT_BYTES) throw new Error(`${label} exceeds ${MAX_TEXT_BYTES} bytes.`);
  return text;
}

async function importFromManifest(
  manifestFile: File,
  fileMap: Map<string, File>,
  ignored: string[],
  warnings: string[],
): Promise<ImportedAlbum> {
  const text = await readBoundedText(manifestFile, 'Manifest');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error('Manifest must be a JSON object.');
  if (parsed.version !== 1) throw new Error('Manifest version must be 1.');
  const title = manifestString(parsed.title, 'Manifest title');
  if (!Array.isArray(parsed.tracks)) throw new Error('Manifest tracks must be an array.');
  if (parsed.tracks.length > MAX_TRACKS) throw new Error(`Manifest tracks must not exceed ${MAX_TRACKS}.`);

  const manifestTracks = parsed.tracks.map((item, index) => parseManifestTrack(item, `tracks[${index}]`));

  const numbers = new Set<number>();
  for (const track of manifestTracks) {
    if (numbers.has(track.number)) throw new Error(`Duplicate manifest track number: ${track.number}.`);
    numbers.add(track.number);
  }
  manifestTracks.sort((a, b) => a.number - b.number);

  const used = new Set<string>();
  function resolve(path: string | undefined, label: string): ImportAsset | undefined {
    if (!path) return undefined;
    const normalized = path.normalize('NFC');
    const file = fileMap.get(normalized);
    if (!file) throw new Error(`${label} references a missing file: "${path}".`);
    used.add(normalized);
    return { path, file };
  }

  const tracks: ImportTrack[] = manifestTracks.map((track, index) => {
    const stem = stemOf(track.audio ?? track.video ?? String(track.number)).normalize('NFC');
    return {
      id: trackId(track.number, stem),
      number: track.number,
      title: track.title,
      artist: track.artist,
      audio: resolve(track.audio, `tracks[${index}].audio`),
      video: resolve(track.video, `tracks[${index}].video`),
      cover: resolve(track.cover, `tracks[${index}].cover`),
      audioLyrics: resolve(track.audioLyrics, `tracks[${index}].audioLyrics`),
      videoLyrics: resolve(track.videoLyrics, `tracks[${index}].videoLyrics`),
      audioCommentary: resolve(track.audioCommentary, `tracks[${index}].audioCommentary`),
      videoCommentary: resolve(track.videoCommentary, `tracks[${index}].videoCommentary`),
      switchPolicy: track.switchPolicy,
    };
  });

  const unrelated = [...fileMap.keys()].filter((path) => !used.has(path));
  if (unrelated.length > 0) {
    warnings.push(`Ignored ${unrelated.length} file(s) not referenced by the manifest.`);
  }

  return { title, tracks, warnings, ignored: [...ignored, ...unrelated].sort() };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function importFolder(files: File[]): Promise<ImportedAlbum> {
  if (files.length > MAX_FILES) {
    throw new Error(`Too many files selected (${files.length}); the limit is ${MAX_FILES}.`);
  }
  if (files.length === 0) {
    return { title: 'Imported Album', tracks: [], warnings: [], ignored: [] };
  }

  const { root, entries } = stripRoot(files);
  const warnings: string[] = [];
  const ignored: string[] = [];
  const fileMap = new Map<string, File>();
  let excludedCount = 0;

  for (const { path, file } of entries) {
    if (!path) continue;
    const normalized = path.normalize('NFC');
    if (isExcludedPath(normalized)) {
      excludedCount += 1;
      ignored.push(normalized);
      continue;
    }
    if (fileMap.has(normalized)) {
      throw new Error(
        `Multiple files collide on the same path once Unicode-normalized: "${normalized}". Rename one to avoid ambiguity.`,
      );
    }
    fileMap.set(normalized, file);
  }
  if (excludedCount > 0) {
    warnings.push(`Ignored ${excludedCount} hidden, node_modules, or backup file(s).`);
  }

  const manifestFile = fileMap.get(MANIFEST_NAME);
  if (manifestFile) {
    fileMap.delete(MANIFEST_NAME);
    return importFromManifest(manifestFile, fileMap, ignored, warnings);
  }
  return importAuto(fileMap, ignored, warnings, root);
}

// ---------------------------------------------------------------------------
// subtitleToVtt: SRT -> VTT conversion (VTT passes through unchanged)
// ---------------------------------------------------------------------------

const SRT_TIME = /^(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})(?:\s.*)?$/;

function convertSrtToVttBody(text: string): string {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (normalized.length === 0) return '';
  const blocks = normalized.split(/\n{2,}/);
  const cues: string[] = [];
  for (const rawBlock of blocks) {
    const lines = rawBlock.split('\n');
    let identifier: string;
    let timingLine: string;
    let textStart: number;
    if (/^\d+$/.test((lines[0] ?? '').trim())) {
      identifier = lines[0].trim();
      timingLine = lines[1] ?? '';
      textStart = 2;
    } else {
      identifier = String(cues.length + 1);
      timingLine = lines[0] ?? '';
      textStart = 1;
    }
    const match = SRT_TIME.exec(timingLine.trim());
    if (!match) throw new Error(`Malformed SRT timestamp in cue ${identifier}: "${timingLine.trim()}"`);
    const start = match[1].replace(',', '.');
    const end = match[2].replace(',', '.');
    const textLines = lines.slice(textStart);
    if (textLines.length === 0) throw new Error(`Malformed SRT cue ${identifier}: missing text.`);
    cues.push(`${identifier}\r\n${start} --> ${end}\r\n${textLines.join('\r\n')}`);
  }
  return cues.join('\r\n\r\n');
}

export function subtitleToVtt(text: string, filename: string): string {
  const ext = extOf(filename);
  if (ext === 'vtt') {
    parseVtt(text);
    return text;
  }
  if (ext !== 'srt') throw new Error(`Unsupported subtitle format: "${filename}".`);
  const body = convertSrtToVttBody(text);
  const vtt = `﻿WEBVTT\r\n\r\n${body}${body ? '\r\n\r\n' : ''}`;
  parseVtt(vtt);
  return vtt;
}
