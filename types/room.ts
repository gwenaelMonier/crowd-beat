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

export type PlaylistTrack = {
  videoId: string;
  title: string;
  durationS: number;
};

export type PlaylistState = {
  tracks: PlaylistTrack[];
  isPlaying: boolean;
  startedAt: number;
  positionAtStart: number;
  updatedAt: number;
};

export type PlaylistAction =
  | { action: 'loadPlaylist'; tracks: PlaylistTrack[] }
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'next' }
  | { action: 'prev' }
  | { action: 'seekToTrack'; index: number }
  | { action: 'seek'; position: number };

export type PlaylistServerEvent =
  | { type: 'state'; state: PlaylistState }
  | { type: 'listeners'; count: number };

export const PLAYLIST_ROOM_KEY = 'room:playlist';
export const PLAYLIST_ROOM_CHANNEL = 'room:playlist:events';
export const PLAYLIST_LISTENER_PREFIX = 'listeners:playlist:';
