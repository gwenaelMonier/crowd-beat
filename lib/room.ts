import { redis } from './redis';
import { ROOM_CHANNEL, ROOM_KEY, type RoomState, type ServerEvent } from '@/types/room';

const INITIAL_STATE: RoomState = {
  videoId: null,
  isPlaying: false,
  startedAt: 0,
  positionAtStart: 0,
  updatedAt: 0,
};

export async function getState(): Promise<RoomState> {
  const stored = await redis.get<RoomState>(ROOM_KEY);
  return stored ?? INITIAL_STATE;
}

export async function setState(state: RoomState): Promise<void> {
  await redis.set(ROOM_KEY, state);
}

export async function publish(event: ServerEvent): Promise<void> {
  await redis.publish(ROOM_CHANNEL, JSON.stringify(event));
}

export async function setStateAndPublish(state: RoomState): Promise<void> {
  await setState(state);
  await publish({ type: 'state', state });
}
