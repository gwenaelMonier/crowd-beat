export type RoomState = {
  videoId: string | null;
  isPlaying: boolean;
  startedAt: number;
  positionAtStart: number;
  updatedAt: number;
};

export type ControlAction =
  | { action: 'load'; videoId: string }
  | { action: 'play' }
  | { action: 'pause'; position: number }
  | { action: 'seek'; position: number };

export type ServerEvent =
  | { type: 'state'; state: RoomState }
  | { type: 'listeners'; count: number };

export const ROOM_KEY = 'room:global';
export const ROOM_CHANNEL = 'room:global:events';
export const LISTENER_PREFIX = 'listeners:';
export const LISTENER_TTL_SECONDS = 15;
