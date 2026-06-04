import type { PlaylistState, PlaylistTrack, PlaylistAction } from '@/types/room';

export function parseIso8601Duration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(min ?? 0) * 60 +
    Number(s ?? 0)
  );
}

export function totalDuration(tracks: PlaylistTrack[]): number {
  return tracks.reduce((sum, t) => sum + t.durationS, 0);
}

export function trackStartOffset(tracks: PlaylistTrack[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index; i++) acc += tracks[i].durationS;
  return acc;
}

export function expectedPlaylistPosition(
  state: PlaylistState,
  serverNowMs: number,
): number {
  if (!state.isPlaying) return state.positionAtStart;
  return state.positionAtStart + (serverNowMs - state.startedAt) / 1000;
}

export type ResolvedPosition = { index: number; offsetS: number; ended: boolean };

export function resolvePlaylistPosition(
  state: PlaylistState,
  serverNowMs: number,
): ResolvedPosition {
  const tracks = state.tracks;
  if (tracks.length === 0) return { index: 0, offsetS: 0, ended: true };

  let pos = expectedPlaylistPosition(state, serverNowMs);
  if (pos < 0) pos = 0;

  const total = totalDuration(tracks);
  const last = tracks.length - 1;
  if (pos >= total) {
    return { index: last, offsetS: tracks[last].durationS, ended: true };
  }

  let acc = 0;
  for (let i = 0; i < tracks.length; i++) {
    const d = tracks[i].durationS;
    if (pos < acc + d) return { index: i, offsetS: pos - acc, ended: false };
    acc += d;
  }
  return { index: last, offsetS: tracks[last].durationS, ended: true };
}

export type PlaylistControlResult =
  | { kind: 'ok'; next: PlaylistState }
  | { kind: 'error'; status: number; message: string };

export function computeNextPlaylistState(
  current: PlaylistState,
  action: PlaylistAction,
  now: number,
): PlaylistControlResult {
  switch (action.action) {
    case 'loadPlaylist': {
      if (action.tracks.length === 0) {
        return { kind: 'error', status: 400, message: 'Empty playlist' };
      }
      return {
        kind: 'ok',
        next: {
          tracks: action.tracks,
          isPlaying: true,
          startedAt: now,
          positionAtStart: 0,
          updatedAt: now,
        },
      };
    }
    case 'play': {
      if (current.tracks.length === 0) {
        return { kind: 'error', status: 400, message: 'No playlist loaded' };
      }
      if (current.isPlaying) return { kind: 'ok', next: current };
      return {
        kind: 'ok',
        next: { ...current, isPlaying: true, startedAt: now, updatedAt: now },
      };
    }
    case 'pause': {
      return {
        kind: 'ok',
        next: {
          ...current,
          isPlaying: false,
          positionAtStart: expectedPlaylistPosition(current, now),
          startedAt: now,
          updatedAt: now,
        },
      };
    }
    case 'seekToTrack': {
      if (action.index < 0 || action.index >= current.tracks.length) {
        return { kind: 'error', status: 400, message: 'Track index out of range' };
      }
      return {
        kind: 'ok',
        next: {
          ...current,
          positionAtStart: trackStartOffset(current.tracks, action.index),
          startedAt: now,
          isPlaying: true,
          updatedAt: now,
        },
      };
    }
    case 'next': {
      const { index } = resolvePlaylistPosition(current, now);
      const target = index + 1;
      if (target >= current.tracks.length) {
        return {
          kind: 'ok',
          next: {
            ...current,
            isPlaying: false,
            positionAtStart: totalDuration(current.tracks),
            startedAt: now,
            updatedAt: now,
          },
        };
      }
      return {
        kind: 'ok',
        next: {
          ...current,
          positionAtStart: trackStartOffset(current.tracks, target),
          startedAt: now,
          isPlaying: true,
          updatedAt: now,
        },
      };
    }
    case 'prev': {
      const { index } = resolvePlaylistPosition(current, now);
      const target = Math.max(0, index - 1);
      return {
        kind: 'ok',
        next: {
          ...current,
          positionAtStart: trackStartOffset(current.tracks, target),
          startedAt: now,
          isPlaying: true,
          updatedAt: now,
        },
      };
    }
  }
}
