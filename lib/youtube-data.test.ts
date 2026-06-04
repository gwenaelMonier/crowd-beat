import { describe, it, expect, vi, afterEach } from 'vitest';
import { parsePlaylistId, fetchPlaylistTracks } from './youtube-data';

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
});
