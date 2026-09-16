import type { Cue, MediaKind, MediaVersion, Track } from './model';

export { parseVtt } from './schema';

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function activeCues(
  cues: Cue[],
  mediaTime: number,
  timelineOffsetMs = 0,
  textOffsetMs = 0,
): Cue[] {
  if (!finite(mediaTime) || !finite(timelineOffsetMs) || !finite(textOffsetMs)) return [];
  const cueClock = mediaTime - timelineOffsetMs / 1000 - textOffsetMs / 1000;
  return cues.filter(
    (cue) =>
      finite(cue.start) &&
      finite(cue.end) &&
      cue.start <= cueClock &&
      cueClock < cue.end,
  );
}

export function seekTime(cue: Cue, timelineOffsetMs = 0, textOffsetMs = 0): number {
  if (!finite(cue.start) || !finite(timelineOffsetMs) || !finite(textOffsetMs)) return 0;
  return Math.max(0, cue.start + timelineOffsetMs / 1000 + textOffsetMs / 1000);
}

export function switchTime(
  time: number,
  from: MediaVersion,
  to: MediaVersion,
  policy: 'aligned' | 'restart',
): number {
  if (policy === 'restart') return 0;
  if (!finite(time)) return 0;
  const fromOffset = from.timelineOffsetMs ?? 0;
  const toOffset = to.timelineOffsetMs ?? 0;
  if (!finite(fromOffset) || !finite(toOffset)) return 0;
  return Math.max(0, time - fromOffset / 1000 + toOffset / 1000);
}

export function chooseVersion(
  track: Track,
  audioOnly: boolean,
  preferred?: MediaKind,
): MediaKind | null {
  if (audioOnly) return track.versions.audio ? 'audio' : null;
  if (preferred && track.versions[preferred]) return preferred;
  if (track.versions[track.defaultVersion]) return track.defaultVersion;
  if (track.versions.audio) return 'audio';
  if (track.versions.video) return 'video';
  return null;
}
