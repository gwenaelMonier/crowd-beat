import { describe, it, expect } from 'vitest';
import { parseIso8601Duration } from './playlist-logic';

describe('parseIso8601Duration', () => {
  it('parses minutes and seconds', () => {
    expect(parseIso8601Duration('PT3M30S')).toBe(210);
  });
  it('parses hours, minutes, seconds', () => {
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
  });
  it('parses seconds only', () => {
    expect(parseIso8601Duration('PT45S')).toBe(45);
  });
  it('parses minutes only', () => {
    expect(parseIso8601Duration('PT10M')).toBe(600);
  });
  it('parses days', () => {
    expect(parseIso8601Duration('P1DT1H')).toBe(90000);
  });
  it('returns 0 for malformed input', () => {
    expect(parseIso8601Duration('garbage')).toBe(0);
  });
});
