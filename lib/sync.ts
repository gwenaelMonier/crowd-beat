export type ClockOffset = { offsetMs: number; rttMs: number };

export async function measureClockOffset(samples = 5): Promise<ClockOffset> {
  const results: ClockOffset[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const res = await fetch('/api/time', { cache: 'no-store' });
    const { now: tServer } = (await res.json()) as { now: number };
    const t1 = Date.now();
    const rttMs = t1 - t0;
    const offsetMs = tServer + rttMs / 2 - t1;
    results.push({ offsetMs, rttMs });
  }
  results.sort((a, b) => a.rttMs - b.rttMs);
  return results[0];
}

export function serverNow(offsetMs: number): number {
  return Date.now() + offsetMs;
}
