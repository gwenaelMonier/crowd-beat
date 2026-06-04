import type { RoomState } from '@/types/room';

export const HARD_CORRECTION_S = 0.3;
export const SOFT_CORRECTION_S = 0.01;
export const MAX_RATE_DELTA = 0.15;
export const RATE_GAIN = 2.0;

export const PLAYER_PLAYING = 1;
export const PLAYER_PAUSED = 2;

export type PlayerState = number;

export type SyncDecision =
  | { kind: 'noop' }
  | { kind: 'play'; seekTo: number }
  | { kind: 'pause' }
  | { kind: 'seek'; to: number }
  | { kind: 'setRate'; rate: number };

export function expectedPosition(state: RoomState, serverNowMs: number): number {
  if (!state.isPlaying) return state.positionAtStart;
  return state.positionAtStart + (serverNowMs - state.startedAt) / 1000;
}

/**
 * Decide what to do when room state changes (SSE event or initial state).
 * Does NOT handle loadVideoById — caller checks videoId change separately.
 */
export function decideOnStateChange(
  state: RoomState,
  playerState: PlayerState,
  serverNowMs: number,
): SyncDecision {
  if (!state.videoId) return { kind: 'noop' };

  if (state.isPlaying) {
    if (playerState !== PLAYER_PLAYING) {
      return { kind: 'play', seekTo: expectedPosition(state, serverNowMs) };
    }
    return { kind: 'noop' };
  }

  if (playerState !== PLAYER_PAUSED) {
    return { kind: 'pause' };
  }
  return { kind: 'noop' };
}

export function decideDriftCorrection(
  expectedS: number,
  playerTimeS: number,
): SyncDecision {
  const drift = expectedS - playerTimeS;
  const abs = Math.abs(drift);

  if (abs > HARD_CORRECTION_S) return { kind: 'seek', to: expectedS };
  if (abs > SOFT_CORRECTION_S) {
    const delta = Math.min(MAX_RATE_DELTA, abs * RATE_GAIN);
    return { kind: 'setRate', rate: drift > 0 ? 1 + delta : 1 - delta };
  }
  return { kind: 'setRate', rate: 1 };
}

/**
 * Decide drift correction on each periodic tick.
 */
export function decideOnTick(
  state: RoomState,
  playerState: PlayerState,
  playerTimeS: number,
  serverNowMs: number,
): SyncDecision {
  if (!state.videoId) return { kind: 'noop' };

  if (!state.isPlaying) {
    if (playerState === PLAYER_PLAYING) {
      return { kind: 'pause' };
    }
    return { kind: 'noop' };
  }

  if (playerState !== PLAYER_PLAYING) return { kind: 'noop' };

  return decideDriftCorrection(expectedPosition(state, serverNowMs), playerTimeS);
}
