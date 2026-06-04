import { describe, it, expect } from 'vitest';
import { parsePlaylistId } from './youtube-data';

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
