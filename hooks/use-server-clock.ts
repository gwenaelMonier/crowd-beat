'use client';

import { useEffect, useState } from 'react';
import { measureClockOffset } from '@/lib/sync';

const RESYNC_INTERVAL_MS = 10_000;

export function useServerClock(): { offsetMs: number; rttMs: number } | null {
  const [clock, setClock] = useState<{ offsetMs: number; rttMs: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const result = await measureClockOffset();
        if (!cancelled) setClock(result);
      } catch {
        // keep last value
      }
    };
    sync();
    const id = setInterval(sync, RESYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return clock;
}
