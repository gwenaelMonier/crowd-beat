import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parsePlaylistId,
  fetchPlaylistTracks,
  isMixPlaylistId,
  MAX_PLAYLIST_TRACKS,
} from './youtube-data';

describe('parsePlaylistId', () => {
  it('extracts list param from a watch URL', () => {
    expect(parsePlaylistId('https://www.youtube.com/watch?v=abc&list=PL123_abc')).toBe('PL123_abc');
  });
  it('extracts list param from a playlist URL', () => {
    expect(parsePlaylistId('https://www.youtube.com/playlist?list=PLxyz-789')).toBe('PLxyz-789');
  });
  it('accepts a raw playlist id', () => {
    expect(parsePlaylistId('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf')).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
  });
  it('returns null for a URL with no list', () => {
    expect(parsePlaylistId('https://www.youtube.com/watch?v=abc')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(parsePlaylistId('   ')).toBeNull();
  });
});

describe('isMixPlaylistId', () => {
  it('flags auto-generated radio/mix ids (RD prefix)', () => {
    expect(isMixPlaylistId('RD2SEYLu8qSNs')).toBe(true);
    expect(isMixPlaylistId('RDMMabcdef')).toBe(true);
    expect(isMixPlaylistId('RDCLAK5uy_xyz')).toBe(true);
  });
  it('does not flag normal user playlists', () => {
    expect(isMixPlaylistId('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf')).toBe(false);
    expect(isMixPlaylistId('OLAK5uy_album')).toBe(false);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('fetchPlaylistTracks', () => {
  it('paginates items then resolves durations, preserving order', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith('/playlistItems')) {
        if (!url.searchParams.get('pageToken')) {
          return jsonResponse({
            nextPageToken: 'PAGE2',
            items: [
              { contentDetails: { videoId: 'vid0000000a' }, snippet: { title: 'Song A' } },
            ],
          });
        }
        return jsonResponse({
          items: [
            { contentDetails: { videoId: 'vid0000000b' }, snippet: { title: 'Song B' } },
          ],
        });
      }
      return jsonResponse({
        items: [
          { id: 'vid0000000a', contentDetails: { duration: 'PT3M' } },
          { id: 'vid0000000b', contentDetails: { duration: 'PT1M30S' } },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await fetchPlaylistTracks('PL123', 'KEY');
    expect(tracks).toEqual([
      { videoId: 'vid0000000a', title: 'Song A', durationS: 180 },
      { videoId: 'vid0000000b', title: 'Song B', durationS: 90 },
    ]);
  });

  it('skips items with no resolvable duration (deleted/private)', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith('/playlistItems')) {
        return jsonResponse({
          items: [
            { contentDetails: { videoId: 'gooooooooood' }, snippet: { title: 'Good' } },
            { contentDetails: { videoId: 'deleteddddd1' }, snippet: { title: 'Gone' } },
          ],
        });
      }
      return jsonResponse({ items: [{ id: 'gooooooooood', contentDetails: { duration: 'PT10S' } }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await fetchPlaylistTracks('PL123', 'KEY');
    expect(tracks).toEqual([{ videoId: 'gooooooooood', title: 'Good', durationS: 10 }]);
  });

  it('throws when the API responds with an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 }) as Response));
    await expect(fetchPlaylistTracks('PL123', 'KEY')).rejects.toThrow();
  });

  it('throws a YouTubeApiError carrying the status and reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: false,
          status: 403,
          json: async () => ({
            error: { message: 'quota exceeded', errors: [{ reason: 'quotaExceeded' }] },
          }),
        }) as unknown as Response),
    );
    await expect(fetchPlaylistTracks('PL123', 'KEY')).rejects.toMatchObject({
      status: 403,
      reason: 'quotaExceeded',
    });
  });

  it('caps pagination on an endless (radio/mix) playlist instead of looping forever', async () => {
    let playlistItemsCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith('/playlistItems')) {
        playlistItemsCalls++;
        // Safety guard: a correct implementation must stop long before this.
        // Without a cap, the do/while loop would call this forever.
        if (playlistItemsCalls > 50) {
          throw new Error('infinite pagination — cap not enforced');
        }
        // Always return a full page WITH a nextPageToken → endless, like an RD mix.
        const items = Array.from({ length: 50 }, (_, i) => {
          const n = (playlistItemsCalls - 1) * 50 + i;
          return {
            contentDetails: { videoId: `vid${String(n).padStart(8, '0')}` },
            snippet: { title: `T${n}` },
          };
        });
        return jsonResponse({ nextPageToken: `tok${playlistItemsCalls}`, items });
      }
      // /videos — return a duration for every requested id
      const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
      return jsonResponse({
        items: ids.map((id) => ({ id, contentDetails: { duration: 'PT1M' } })),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await fetchPlaylistTracks('RDmix', 'KEY');
    expect(tracks.length).toBe(MAX_PLAYLIST_TRACKS);
    expect(playlistItemsCalls).toBe(MAX_PLAYLIST_TRACKS / 50);
  });
});
