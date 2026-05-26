import { describe, it, expect } from 'vitest';
import { parseVideoId } from './youtube';

describe('parseVideoId', () => {
  it('parses a raw 11-char video ID', () => {
    expect(parseVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtu.be short link', () => {
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtube.com/watch?v=', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtube.com/watch?v= without www', () => {
    expect(parseVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses m.youtube.com', () => {
    expect(parseVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses /embed/ URLs', () => {
    expect(parseVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses /shorts/ URLs', () => {
    expect(parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('trims whitespace', () => {
    expect(parseVideoId('  dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects empty string', () => {
    expect(parseVideoId('')).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(parseVideoId('hello world!')).toBeNull();
  });

  it('rejects spoofed hostname like evilyoutube.com', () => {
    expect(parseVideoId('https://evilyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('rejects subdomain spoofing like fake.youtube.com', () => {
    expect(parseVideoId('https://fake.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('rejects too-short video ID', () => {
    expect(parseVideoId('abc')).toBeNull();
  });

  it('rejects too-long video ID', () => {
    expect(parseVideoId('abcdefghijkl')).toBeNull();
  });

  it('handles extra query params in youtube.com URL', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toBe('dQw4w9WgXcQ');
  });
});
