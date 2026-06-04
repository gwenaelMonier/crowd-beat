import { getPlaylistState } from '@/lib/playlist-room';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getPlaylistState();
  return Response.json(state, { headers: { 'Cache-Control': 'no-store' } });
}
