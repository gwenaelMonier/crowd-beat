import { redis } from './redis';
import {
  PLAYLIST_ROOM_CHANNEL,
  PLAYLIST_ROOM_KEY,
  type PlaylistServerEvent,
  type PlaylistState,
} from '@/types/room';

export const INITIAL_PLAYLIST_STATE: PlaylistState = {
  tracks: [],
  isPlaying: false,
  startedAt: 0,
  positionAtStart: 0,
  updatedAt: 0,
  shuffle: false,
};

export async function getPlaylistState(): Promise<PlaylistState> {
  const stored = await redis.get<PlaylistState>(PLAYLIST_ROOM_KEY);
  // Spread over the initial state so fields added later (e.g. shuffle) are
  // backfilled on blobs written before they existed.
  return stored ? { ...INITIAL_PLAYLIST_STATE, ...stored } : INITIAL_PLAYLIST_STATE;
}

export async function setPlaylistState(state: PlaylistState): Promise<void> {
  await redis.set(PLAYLIST_ROOM_KEY, state);
}

export async function publishPlaylist(event: PlaylistServerEvent): Promise<void> {
  await redis.publish(PLAYLIST_ROOM_CHANNEL, JSON.stringify(event));
}

export async function setPlaylistStateAndPublish(state: PlaylistState): Promise<void> {
  await setPlaylistState(state);
  await publishPlaylist({ type: 'state', state });
}
