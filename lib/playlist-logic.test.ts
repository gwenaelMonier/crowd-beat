import { describe, it, expect } from 'vitest';
import { parseIso8601Duration } from './playlist-logic';
import {
  totalDuration,
  expectedPlaylistPosition,
  resolvePlaylistPosition,
  trackStartOffset,
} from './playlist-logic';
import { computeNextPlaylistState } from './playlist-logic';
import type { PlaylistState, PlaylistAction } from '@/types/room';

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

const NOW = 10_000;

describe('computeNextPlaylistState', () => {
  it('loads a playlist starting at position 0 and playing', () => {
    const empty: PlaylistState = {
      tracks: [], isPlaying: false, startedAt: 0, positionAtStart: 0, updatedAt: 0,
    };
    const action: PlaylistAction = { action: 'loadPlaylist', tracks: TRACKS };
    const result = computeNextPlaylistState(empty, action, NOW);
    expect(result).toEqual({
      kind: 'ok',
      next: { tracks: TRACKS, isPlaying: true, startedAt: NOW, positionAtStart: 0, updatedAt: NOW },
    });
  });
  it('rejects an empty playlist load', () => {
    const empty: PlaylistState = {
      tracks: [], isPlaying: false, startedAt: 0, positionAtStart: 0, updatedAt: 0,
    };
    const result = computeNextPlaylistState(empty, { action: 'loadPlaylist', tracks: [] }, NOW);
    expect(result.kind).toBe('error');
  });
  it('pause freezes the current global position', () => {
    const result = computeNextPlaylistState(PLAYING, { action: 'pause' }, 31_000);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.isPlaying).toBe(false);
    expect(result.next.positionAtStart).toBeCloseTo(30);
  });
  it('play resumes from the frozen position', () => {
    const paused: PlaylistState = {
      tracks: TRACKS, isPlaying: false, startedAt: 5_000, positionAtStart: 42, updatedAt: 5_000,
    };
    const result = computeNextPlaylistState(paused, { action: 'play' }, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next).toEqual({
      tracks: TRACKS, isPlaying: true, startedAt: NOW, positionAtStart: 42, updatedAt: NOW,
    });
  });
  it('seekToTrack jumps to the track start offset', () => {
    const result = computeNextPlaylistState(PLAYING, { action: 'seekToTrack', index: 2 }, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.positionAtStart).toBe(300);
    expect(result.next.isPlaying).toBe(true);
  });
  it('seekToTrack rejects an out-of-range index', () => {
    const result = computeNextPlaylistState(PLAYING, { action: 'seekToTrack', index: 9 }, NOW);
    expect(result.kind).toBe('error');
  });
  it('next advances to the following track', () => {
    const result = computeNextPlaylistState(PLAYING, { action: 'next' }, 31_000);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.positionAtStart).toBe(100);
    expect(result.next.isPlaying).toBe(true);
  });
  it('next on the last track stops at the end', () => {
    const result = computeNextPlaylistState(PLAYING, { action: 'next' }, 321_000);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.isPlaying).toBe(false);
    expect(result.next.positionAtStart).toBe(350);
  });
  it('prev goes to the previous track, floored at 0', () => {
    const result = computeNextPlaylistState(PLAYING, { action: 'prev' }, 151_000);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.positionAtStart).toBe(0);
  });
});
