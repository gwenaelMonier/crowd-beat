import { getPlaylistState } from '@/lib/playlist-room';
import { PLAYLIST_LISTENER_PREFIX } from '@/types/room';
import { createRoomStream } from '@/lib/room-stream';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  return await createRoomStream({
    listenerPrefix: PLAYLIST_LISTENER_PREFIX,
    getState: getPlaylistState,
  });
}
