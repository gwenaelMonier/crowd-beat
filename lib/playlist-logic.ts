import type { PlaylistState, PlaylistTrack } from '@/types/room';

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
