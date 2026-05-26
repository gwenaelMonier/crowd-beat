import { describe, it, expect, vi, beforeEach } from 'vitest';
import { measureClockOffset, serverNow } from './sync';

describe('serverNow', () => {
  it('adds offset to Date.now()', () => {
    const before = Date.now();
    const result = serverNow(100);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before + 100);
    expect(result).toBeLessThanOrEqual(after + 100);
  });

  it('works with negative offset', () => {
    const before = Date.now();
    const result = serverNow(-50);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before - 50);
    expect(result).toBeLessThanOrEqual(after - 50);
  });
});

describe('measureClockOffset', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns median offset and rtt from samples', async () => {
    let call = 0;
    const serverTime = 100_000;
    const rtts = [10, 50, 20, 30, 40];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const rtt = rtts[call++ % rtts.length];
      const t0 = Date.now();
      return {
        json: async () => {
          const t1 = t0 + rtt;
          vi.spyOn(Date, 'now').mockReturnValueOnce(t1);
          return { now: serverTime };
        },
      } as Response;
    });

    const result = await measureClockOffset(5);
    expect(result).toHaveProperty('offsetMs');
    expect(result).toHaveProperty('rttMs');
    expect(typeof result.offsetMs).toBe('number');
    expect(typeof result.rttMs).toBe('number');
  });

  it('uses average of best samples for offset and rtt', async () => {
    let call = 0;
    const serverBase = 50_000;
    const scenarios = [
      { rtt: 2, serverNow: serverBase },
      { rtt: 100, serverNow: serverBase },
      { rtt: 20, serverNow: serverBase },
    ];

    let fakeNow = 10_000;

    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const scenario = scenarios[call++ % scenarios.length];
      const t0 = fakeNow;
      return {
        json: async () => {
          fakeNow = t0 + scenario.rtt;
          return { now: scenario.serverNow };
        },
      } as Response;
    });

    const result = await measureClockOffset(3);
    // sorted by rtt: [2, 20, 100], best 3 → avg rtt = (2+20+100)/3 ≈ 41
    expect(result.rttMs).toBe(41);
  });
});
