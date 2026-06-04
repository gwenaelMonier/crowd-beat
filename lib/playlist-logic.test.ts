import { describe, it, expect } from 'vitest';
import { parseIso8601Duration } from './playlist-logic';
import {
  totalDuration,
  expectedPlaylistPosition,
  resolvePlaylistPosition,
  trackStartOffset,
} from './playlist-logic';
import type { PlaylistState } from '@/types/room';

describe('parseIso8601Duration', () => {
  it('parses minutes and seconds', () => {
    expect(parseIso8601Duration('PT3M30S')).toBe(210);
  });
  it('parses hours, minutes, seconds', () => {
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
  });
  it('parses seconds only', () => {
    expect(parseIso8601Duration('PT45S')).toBe(45);
  });
  it('parses minutes only', () => {
    expect(parseIso8601Duration('PT10M')).toBe(600);
  });
  it('parses days', () => {
    expect(parseIso8601Duration('P1DT1H')).toBe(90000);
  });
  it('returns 0 for malformed input', () => {
    expect(parseIso8601Duration('garbage')).toBe(0);
  });
});

const TRACKS = [
  { videoId: 'aaaaaaaaaaa', title: 'A', durationS: 100 },
  { videoId: 'bbbbbbbbbbb', title: 'B', durationS: 200 },
  { videoId: 'ccccccccccc', title: 'C', durationS: 50 },
];

const PLAYING: PlaylistState = {
  tracks: TRACKS,
  isPlaying: true,
  startedAt: 1000,
  positionAtStart: 0,
  updatedAt: 1000,
};

describe('totalDuration', () => {
  it('sums track durations', () => {
    expect(totalDuration(TRACKS)).toBe(350);
  });
});

describe('trackStartOffset', () => {
  it('returns cumulative seconds before a track', () => {
    expect(trackStartOffset(TRACKS, 0)).toBe(0);
    expect(trackStartOffset(TRACKS, 1)).toBe(100);
    expect(trackStartOffset(TRACKS, 2)).toBe(300);
  });
});

describe('expectedPlaylistPosition', () => {
  it('advances with elapsed wall-clock when playing', () => {
    expect(expectedPlaylistPosition(PLAYING, 31_000)).toBeCloseTo(30);
  });
  it('is frozen at positionAtStart when paused', () => {
    const paused = { ...PLAYING, isPlaying: false, positionAtStart: 42 };
    expect(expectedPlaylistPosition(paused, 999_000)).toBe(42);
  });
});

describe('resolvePlaylistPosition', () => {
  it('resolves within the first track', () => {
    expect(resolvePlaylistPosition(PLAYING, 31_000)).toEqual({
      index: 0, offsetS: 30, ended: false,
    });
  });
  it('crosses into the second track', () => {
    expect(resolvePlaylistPosition(PLAYING, 151_000)).toEqual({
      index: 1, offsetS: 50, ended: false,
    });
  });
  it('lands exactly on a track boundary at the start of the next track', () => {
    expect(resolvePlaylistPosition(PLAYING, 101_000)).toEqual({
      index: 1, offsetS: 0, ended: false,
    });
  });
  it('reports ended past the total duration, parked on the last track', () => {
    expect(resolvePlaylistPosition(PLAYING, 401_000)).toEqual({
      index: 2, offsetS: 50, ended: true,
    });
  });
  it('reports ended for an empty playlist', () => {
    const empty = { ...PLAYING, tracks: [] };
    expect(resolvePlaylistPosition(empty, 5_000)).toEqual({
      index: 0, offsetS: 0, ended: true,
    });
  });
});
