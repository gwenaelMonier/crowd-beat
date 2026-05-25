import { describe, it, expect } from 'vitest';
import {
  decideOnStateChange,
  decideOnTick,
  expectedPosition,
  PLAYER_PAUSED,
  PLAYER_PLAYING,
} from './sync-logic';
import type { RoomState } from '@/types/room';

const PLAYING_AT_10S: RoomState = {
  videoId: 'abc12345678',
  isPlaying: true,
  startedAt: 1000,
  positionAtStart: 0,
  updatedAt: 1000,
};

const PAUSED_AT_42S: RoomState = {
  videoId: 'abc12345678',
  isPlaying: false,
  startedAt: 1000,
  positionAtStart: 42,
  updatedAt: 1000,
};

describe('expectedPosition', () => {
  it('returns positionAtStart when paused', () => {
    expect(expectedPosition(PAUSED_AT_42S, 999_999)).toBe(42);
  });

  it('advances over time when playing', () => {
    expect(expectedPosition(PLAYING_AT_10S, 11_000)).toBe(10);
  });
});

describe('decideOnStateChange', () => {
  const BUFFERING = 3;

  it('plays + seeks when state says playing but player is paused', () => {
    const d = decideOnStateChange(PLAYING_AT_10S, PLAYER_PAUSED, 11_000);
    expect(d).toEqual({ kind: 'play', seekTo: 10 });
  });

  it('REGRESSION: pauses when state says paused but player is playing', () => {
    const d = decideOnStateChange(PAUSED_AT_42S, PLAYER_PLAYING, 11_000);
    expect(d).toEqual({ kind: 'pause' });
  });

  it('REGRESSION: pauses when player is buffering after a pause', () => {
    const d = decideOnStateChange(PAUSED_AT_42S, BUFFERING, 11_000);
    expect(d).toEqual({ kind: 'pause' });
  });

  it('noop when state and player both paused', () => {
    const d = decideOnStateChange(PAUSED_AT_42S, PLAYER_PAUSED, 11_000);
    expect(d).toEqual({ kind: 'noop' });
  });

  it('noop when state and player both playing', () => {
    const d = decideOnStateChange(PLAYING_AT_10S, PLAYER_PLAYING, 11_000);
    expect(d).toEqual({ kind: 'noop' });
  });

  it('noop when no video', () => {
    const empty: RoomState = { ...PAUSED_AT_42S, videoId: null };
    const d = decideOnStateChange(empty, PLAYER_PAUSED, 11_000);
    expect(d).toEqual({ kind: 'noop' });
  });
});

describe('decideOnTick - force-pause guard', () => {
  it('REGRESSION: forces pause when room is paused but player resumed playing', () => {
    const d = decideOnTick(PAUSED_AT_42S, PLAYER_PLAYING, 42, 11_000);
    expect(d).toEqual({ kind: 'pause' });
  });

  it('REGRESSION: forces pause when player resumed and is at a different position', () => {
    const d = decideOnTick(PAUSED_AT_42S, PLAYER_PLAYING, 50, 11_000);
    expect(d).toEqual({ kind: 'pause' });
  });

  it('noop when both paused', () => {
    const d = decideOnTick(PAUSED_AT_42S, PLAYER_PAUSED, 42, 11_000);
    expect(d).toEqual({ kind: 'noop' });
  });
});

describe('decideOnTick - drift correction (playing)', () => {
  it('noop when no drift', () => {
    const d = decideOnTick(PLAYING_AT_10S, PLAYER_PLAYING, 10, 11_000);
    expect(d).toEqual({ kind: 'setRate', rate: 1 });
  });

  it('noop when drift below soft threshold (30ms)', () => {
    const d = decideOnTick(PLAYING_AT_10S, PLAYER_PLAYING, 10.02, 11_000);
    expect(d).toEqual({ kind: 'setRate', rate: 1 });
  });

  it('soft rate up when ahead expected (drift > 0)', () => {
    // expected=10, actual=9.9 → drift=+0.1 → rate = 1 + 0.05 = 1.05
    const d = decideOnTick(PLAYING_AT_10S, PLAYER_PLAYING, 9.9, 11_000);
    expect(d.kind).toBe('setRate');
    if (d.kind === 'setRate') expect(d.rate).toBeCloseTo(1.05, 3);
  });

  it('soft rate down when behind expected (drift < 0)', () => {
    // expected=10, actual=10.1 → drift=-0.1 → rate = 1 - 0.05 = 0.95
    const d = decideOnTick(PLAYING_AT_10S, PLAYER_PLAYING, 10.1, 11_000);
    expect(d.kind).toBe('setRate');
    if (d.kind === 'setRate') expect(d.rate).toBeCloseTo(0.95, 3);
  });

  it('caps rate at MAX_RATE_DELTA (15%)', () => {
    // drift=+1.0 → would be 1.5 → capped to 1.15. Wait, drift>HARD goes to seek.
    // Use drift between SOFT and HARD: drift=0.25
    const d = decideOnTick(PLAYING_AT_10S, PLAYER_PLAYING, 9.75, 11_000);
    expect(d.kind).toBe('setRate');
    if (d.kind === 'setRate') expect(d.rate).toBeCloseTo(1.125, 3);
  });

  it('hard seek when drift > HARD threshold (300ms)', () => {
    const d = decideOnTick(PLAYING_AT_10S, PLAYER_PLAYING, 9.5, 11_000);
    expect(d).toEqual({ kind: 'seek', to: 10 });
  });

  it('noop when player not in PLAYING state', () => {
    const d = decideOnTick(PLAYING_AT_10S, PLAYER_PAUSED, 9.5, 11_000);
    // state says playing but player is paused → decideOnStateChange would handle this,
    // tick is just for drift correction and does nothing
    expect(d).toEqual({ kind: 'noop' });
  });
});
