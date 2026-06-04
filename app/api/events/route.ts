import { getState } from '@/lib/room';
import { LISTENER_PREFIX } from '@/types/room';
import { createRoomStream } from '@/lib/room-stream';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  return await createRoomStream({ listenerPrefix: LISTENER_PREFIX, getState });
}
