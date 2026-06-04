import { getPlaylistState, setPlaylistStateAndPublish } from '@/lib/playlist-room';
import { computeNextPlaylistState } from '@/lib/playlist-logic';
import type { PlaylistAction } from '@/types/room';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as PlaylistAction;
  const current = await getPlaylistState();
  const result = computeNextPlaylistState(current, body, Date.now());

  if (result.kind === 'error') {
    return Response.json({ error: result.message }, { status: result.status });
  }

  await setPlaylistStateAndPublish(result.next);
  return Response.json(result.next);
}
