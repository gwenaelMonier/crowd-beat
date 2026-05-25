import { describe, it, expect } from 'vitest';
import { computeNextState } from './control-logic';
import type { RoomState } from '@/types/room';

const EMPTY: RoomState = {
  videoId: null,
  isPlaying: false,
  startedAt: 0,
  positionAtStart: 0,
  updatedAt: 0,
};

const PLAYING: RoomState = {
  videoId: 'dQw4w9WgXcQ',
  isPlaying: true,
  startedAt: 1000,
  positionAtStart: 0,
  updatedAt: 1000,
};

const PAUSED: RoomState = {
  videoId: 'dQw4w9WgXcQ',
  isPlaying: false,
  startedAt: 1000,
  positionAtStart: 42,
  updatedAt: 1000,
};

describe('computeNextState - load', () => {
  it('loads a fresh video from URL', () => {
    const r = computeNextState(EMPTY, { action: 'load', videoId: 'https://youtu.be/dQw4w9WgXcQ' }, 5000);
    expect(r).toEqual({
      kind: 'ok',
      next: { videoId: 'dQw4w9WgXcQ', isPlaying: true, startedAt: 5000, positionAtStart: 0, updatedAt: 5000 },
    });
  });

  it('rejects invalid videoId', () => {
    const r = computeNextState(EMPTY, { action: 'load', videoId: 'garbage' }, 5000);
    expect(r.kind).toBe('error');
  });

  it('replaces currently playing video', () => {
    const r = computeNextState(PLAYING, { action: 'load', videoId: 'xxxxxxxxxxx' }, 5000);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.next.videoId).toBe('xxxxxxxxxxx');
  });
});

describe('computeNextState - play', () => {
  it('errors when no video loaded', () => {
    const r = computeNextState(EMPTY, { action: 'play' }, 5000);
    expect(r.kind).toBe('error');
  });

  it('is a no-op when already playing', () => {
    const r = computeNextState(PLAYING, { action: 'play' }, 5000);
    expect(r).toEqual({ kind: 'ok', next: PLAYING });
  });

  it('resumes from paused position', () => {
    const r = computeNextState(PAUSED, { action: 'play' }, 5000);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.next.isPlaying).toBe(true);
      expect(r.next.startedAt).toBe(5000);
      expect(r.next.positionAtStart).toBe(42);
    }
  });
});

describe('computeNextState - pause', () => {
  it('pauses a playing video and captures position', () => {
    const r = computeNextState(PLAYING, { action: 'pause', position: 17.5 }, 5000);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.next.isPlaying).toBe(false);
      expect(r.next.positionAtStart).toBe(17.5);
      expect(r.next.startedAt).toBe(5000);
    }
  });

  it('REGRESSION: pausing an already-paused video keeps isPlaying false', () => {
    const r = computeNextState(PAUSED, { action: 'pause', position: 99 }, 5000);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.next.isPlaying).toBe(false);
  });
});

describe('computeNextState - seek', () => {
  it('seeks while playing keeps isPlaying true', () => {
    const r = computeNextState(PLAYING, { action: 'seek', position: 120 }, 5000);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.next.isPlaying).toBe(true);
      expect(r.next.positionAtStart).toBe(120);
      expect(r.next.startedAt).toBe(5000);
    }
  });

  it('REGRESSION: seeking while paused must NOT resume playback', () => {
    const r = computeNextState(PAUSED, { action: 'seek', position: 120 }, 5000);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.next.isPlaying).toBe(false);
      expect(r.next.positionAtStart).toBe(120);
    }
  });
});
