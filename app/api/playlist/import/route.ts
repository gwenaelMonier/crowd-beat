import { parsePlaylistId, fetchPlaylistTracks } from '@/lib/youtube-data';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { url } = (await req.json()) as { url?: string };
  const playlistId = parsePlaylistId(url ?? '');
  if (!playlistId) {
    return Response.json({ error: 'Invalid playlist URL' }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'Server missing YOUTUBE_API_KEY' }, { status: 500 });
  }

  try {
    const tracks = await fetchPlaylistTracks(playlistId, apiKey);
    if (tracks.length === 0) {
      return Response.json({ error: 'Playlist empty or unavailable' }, { status: 404 });
    }
    return Response.json({ tracks });
  } catch {
    return Response.json({ error: 'Failed to fetch playlist' }, { status: 502 });
  }
}
