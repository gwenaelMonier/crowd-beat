import type { PlaylistTrack } from '@/types/room';
import { parseIso8601Duration } from '@/lib/playlist-logic';

const PLAYLIST_ID_REGEX = /^[A-Za-z0-9_-]+$/;

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get('list');
    if (list && PLAYLIST_ID_REGEX.test(list)) return list;
    return null;
  } catch {
    // not a URL — fall through to raw-id check
  }
  return PLAYLIST_ID_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * YouTube auto-generated Mix/Radio playlists have ids starting with "RD"
 * (RD, RDMM, RDCLAK, RDEM, …). They are dynamic and effectively infinite,
 * unlike normal user playlists ("PL…") or album playlists ("OLAK…").
 */
export function isMixPlaylistId(id: string): boolean {
  return id.startsWith('RD');
}

const API_BASE = 'https://www.googleapis.com/youtube/v3';

/** Error thrown when the YouTube Data API rejects a request, carrying the HTTP
 *  status and YouTube's machine-readable reason (e.g. "quotaExceeded"). */
export class YouTubeApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}

async function youTubeError(res: Response): Promise<YouTubeApiError> {
  let reason: string | null = null;
  let message = `YouTube API request failed (${res.status})`;
  try {
    const body = (await res.json()) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    reason = body.error?.errors?.[0]?.reason ?? null;
    if (body.error?.message) message = body.error.message;
  } catch {
    // non-JSON error body — keep defaults
  }
  return new YouTubeApiError(res.status, reason, message);
}

// Upper bound on how many tracks we import from a single playlist. This both
// keeps a party playlist sane and, critically, prevents an unbounded fetch loop
// on auto-generated YouTube Mix/Radio playlists (ids starting with "RD"), which
// paginate endlessly — every page returns a fresh nextPageToken, so without a
// cap the import request never resolves.
export const MAX_PLAYLIST_TRACKS = 200;

type PlaylistItemsResponse = {
  nextPageToken?: string;
  items: { contentDetails: { videoId: string }; snippet: { title: string } }[];
};

type VideosResponse = {
  items: { id: string; contentDetails: { duration: string } }[];
};

export async function fetchPlaylistTracks(
  playlistId: string,
  apiKey: string,
): Promise<PlaylistTrack[]> {
  // 1. Collect video ids + titles, following pagination.
  const items: { videoId: string; title: string }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${API_BASE}/playlistItems`);
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw await youTubeError(res);
    const data = (await res.json()) as PlaylistItemsResponse;
    for (const it of data.items) {
      items.push({ videoId: it.contentDetails.videoId, title: it.snippet.title });
    }
    pageToken = data.nextPageToken;
  } while (pageToken && items.length < MAX_PLAYLIST_TRACKS);

  // Cap the playlist so an endless Mix/Radio (or a huge playlist) stays bounded.
  if (items.length > MAX_PLAYLIST_TRACKS) items.length = MAX_PLAYLIST_TRACKS;

  // 2. Resolve durations in batches of 50.
  const durations = new Map<string, number>();
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const url = new URL(`${API_BASE}/videos`);
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('id', batch.map((b) => b.videoId).join(','));
    url.searchParams.set('key', apiKey);

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw await youTubeError(res);
    const data = (await res.json()) as VideosResponse;
    for (const v of data.items) {
      durations.set(v.id, parseIso8601Duration(v.contentDetails.duration));
    }
  }

  // 3. Build tracks in playlist order, dropping unavailable videos.
  return items
    .filter((it) => durations.has(it.videoId))
    .map((it) => ({
      videoId: it.videoId,
      title: it.title,
      durationS: durations.get(it.videoId)!,
    }));
}
