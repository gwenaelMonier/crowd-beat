import {
  parsePlaylistId,
  fetchPlaylistTracks,
  isMixPlaylistId,
  MAX_PLAYLIST_TRACKS,
  YouTubeApiError,
} from '@/lib/youtube-data';

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

    let notice: string | undefined;
    if (isMixPlaylistId(playlistId)) {
      notice = `This is a YouTube Mix/Radio (auto-generated). Imported the first ${tracks.length} tracks — order may be arbitrary. For a fixed order, use a normal playlist URL.`;
    } else if (tracks.length >= MAX_PLAYLIST_TRACKS) {
      notice = `Long playlist — imported the first ${MAX_PLAYLIST_TRACKS} tracks only.`;
    }

    return Response.json({ tracks, notice });
  } catch (e) {
    if (e instanceof YouTubeApiError) {
      if (e.reason === 'quotaExceeded' || e.status === 403) {
        return Response.json(
          {
            error:
              'YouTube API quota exceeded for today. Try again after the daily reset (midnight Pacific Time) or use another API key.',
          },
          { status: 429 },
        );
      }
      if (e.status === 404) {
        return Response.json(
          { error: 'Playlist not found, private, or unavailable.' },
          { status: 404 },
        );
      }
    }
    return Response.json({ error: 'Failed to fetch playlist' }, { status: 502 });
  }
}
