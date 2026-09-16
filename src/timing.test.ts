import { describe, expect, it } from 'vitest';
import type { Cue, MediaVersion, Track } from './model';
import { activeCues, chooseVersion, parseVtt, seekTime, switchTime } from './timing';

it('re-exports the VTT parser for player timing consumers', () => {
  expect(parseVtt('WEBVTT\n\n00:00.000 --> 00:01.000\nline\n')).toHaveLength(1);
});

const cues: Cue[] = [
  { id: 'a', start: 1, end: 3, text: 'A' },
  { id: 'b', start: 2, end: 4, text: 'B' },
];

describe('activeCues', () => {
  it('uses inclusive starts, exclusive ends, and returns overlaps', () => {
    expect(activeCues(cues, 1).map((cue) => cue.id)).toEqual(['a']);
    expect(activeCues(cues, 2.5).map((cue) => cue.id)).toEqual(['a', 'b']);
    expect(activeCues(cues, 3).map((cue) => cue.id)).toEqual(['b']);
    expect(activeCues(cues, 4)).toEqual([]);
  });

  it('subtracts timeline and text offsets from the media clock', () => {
    expect(activeCues(cues, 4, 2000, 1000).map((cue) => cue.id)).toEqual(['a']);
    expect(activeCues(cues, 0.75, 0, -250).map((cue) => cue.id)).toEqual(['a']);
  });

  it('returns no cues for a non-finite clock', () => {
    expect(activeCues(cues, Number.NaN)).toEqual([]);
  });
});

describe('seekTime', () => {
  it('maps cue time back to media time and clamps before-zero results', () => {
    expect(seekTime(cues[0], 2000, 500)).toBe(3.5);
    expect(seekTime({ ...cues[0], start: 0 }, -1000, 0)).toBe(0);
  });
});

describe('switchTime', () => {
  const version = (timelineOffsetMs?: number): MediaVersion => ({
    resource: { service: 'AUDIO', name: 'Publisher', identifier: 'media' },
    timelineOffsetMs,
  });

  it('maps aligned versions through their shared timeline', () => {
    expect(switchTime(10, version(3000), version(1000), 'aligned')).toBe(8);
    expect(switchTime(1, version(3000), version(0), 'aligned')).toBe(0);
  });

  it('restarts at the beginning under restart policy', () => {
    expect(switchTime(10, version(3000), version(1000), 'restart')).toBe(0);
  });
});

describe('chooseVersion', () => {
  const track = (versions: Track['versions'], defaultVersion: Track['defaultVersion']): Track => ({
    id: 'track',
    title: 'Track',
    artist: 'Artist',
    defaultVersion,
    switchPolicy: 'restart',
    versions,
  });
  const audio: MediaVersion = {
    resource: { service: 'AUDIO', name: 'Publisher', identifier: 'audio' },
  };
  const video: MediaVersion = {
    resource: { service: 'VIDEO', name: 'Publisher', identifier: 'video' },
  };

  it('honors audio-only, preferred, and default selection in that order', () => {
    const paired = track({ audio, video }, 'audio');
    expect(chooseVersion(paired, true, 'video')).toBe('audio');
    expect(chooseVersion(paired, false, 'video')).toBe('video');
    expect(chooseVersion(paired, false)).toBe('audio');
  });

  it('returns null for video-only tracks in audio-only mode', () => {
    expect(chooseVersion(track({ video }, 'video'), true)).toBeNull();
  });

  it('falls back safely for an unavailable preference or malformed default', () => {
    expect(chooseVersion(track({ video }, 'video'), false, 'audio')).toBe('video');
    expect(chooseVersion(track({ audio }, 'video'), false)).toBe('audio');
    expect(chooseVersion(track({}, 'audio'), false)).toBeNull();
  });
});
