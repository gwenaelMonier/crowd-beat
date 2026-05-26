export type ClockOffset = { offsetMs: number; rttMs: number };

export async function measureClockOffset(samples = 11): Promise<ClockOffset> {
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
  const mid = Math.floor(results.length / 2);
  const medianOffset = results.length % 2 === 0
    ? (results[mid - 1].offsetMs + results[mid].offsetMs) / 2
    : results[mid].offsetMs;
  const best = results.slice(0, Math.max(3, Math.floor(samples / 3)));
  const avgRtt = best.reduce((s, r) => s + r.rttMs, 0) / best.length;
  return { offsetMs: Math.round(medianOffset), rttMs: Math.round(avgRtt) };
}

export function serverNow(offsetMs: number): number {
  return Date.now() + offsetMs;
}
