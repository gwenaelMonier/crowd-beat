import type { ControlAction, RoomState } from '@/types/room';
import { parseVideoId } from '@/lib/youtube';

export type ControlResult =
  | { kind: 'ok'; next: RoomState }
  | { kind: 'error'; status: number; message: string };

export function computeNextState(
  current: RoomState,
  action: ControlAction,
  now: number,
): ControlResult {
  switch (action.action) {
    case 'load': {
      const videoId = parseVideoId(action.videoId);
      if (!videoId) return { kind: 'error', status: 400, message: 'Invalid videoId' };
      return {
        kind: 'ok',
        next: {
          videoId,
          isPlaying: true,
          startedAt: now,
          positionAtStart: 0,
          updatedAt: now,
        },
      };
    }
    case 'play': {
      if (!current.videoId) {
        return { kind: 'error', status: 400, message: 'No video loaded' };
      }
      if (current.isPlaying) {
        return { kind: 'ok', next: current };
      }
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
          positionAtStart: action.position,
          startedAt: now,
          updatedAt: now,
        },
      };
    }
    case 'seek': {
      return {
        kind: 'ok',
        next: {
          ...current,
          startedAt: now,
          positionAtStart: action.position,
          updatedAt: now,
        },
      };
    }
  }
}
