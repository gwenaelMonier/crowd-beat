import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parsePlaylistId,
  fetchPlaylistTracks,
  isMixPlaylistId,
  MAX_PLAYLIST_TRACKS,
  MAX_MIX_TRACKS,
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

  // Builds a fetch mock that serves `total` playlist items across pages of 50,
  // each video resolving to a 1-minute duration. If `total` is null the stream
  // is endless (every page carries a nextPageToken) — like an RD mix. `guard`
  // throws if pagination runs away, so an unbounded loop fails loudly.
  function paginatedFetch(total: number | null, guard: number) {
    let calls = 0;
    return vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith('/playlistItems')) {
        calls++;
        if (calls > guard) throw new Error('pagination cap not enforced');
        const start = (calls - 1) * 50;
        const count = total === null ? 50 : Math.min(50, total - start);
        const items = Array.from({ length: count }, (_, i) => {
          const n = start + i;
          return {
            contentDetails: { videoId: `vid${String(n).padStart(8, '0')}` },
            snippet: { title: `T${n}` },
          };
        });
        const hasMore = total === null || start + count < total;
        return jsonResponse(hasMore ? { nextPageToken: `tok${calls}`, items } : { items });
      }
      const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
      return jsonResponse({
        items: ids.map((id) => ({ id, contentDetails: { duration: 'PT1M' } })),
      });
    });
  }

  it('caps an endless (radio/mix) playlist at MAX_MIX_TRACKS instead of looping forever', async () => {
    const fetchMock = paginatedFetch(null, 50);
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await fetchPlaylistTracks('RDmix', 'KEY');
    expect(tracks.length).toBe(MAX_MIX_TRACKS);
  });

  it('does NOT truncate a normal (PL) playlist at the mix limit', async () => {
    // A 260-track playlist must import all 260 — the mix cap must not apply.
    const fetchMock = paginatedFetch(260, 50);
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await fetchPlaylistTracks('PLnormal', 'KEY');
    expect(tracks.length).toBe(260);
  });

  it('still bounds a pathologically endless normal playlist at MAX_PLAYLIST_TRACKS', async () => {
    const fetchMock = paginatedFetch(null, MAX_PLAYLIST_TRACKS / 50 + 5);
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await fetchPlaylistTracks('PLendless', 'KEY');
    expect(tracks.length).toBe(MAX_PLAYLIST_TRACKS);
  });
});
