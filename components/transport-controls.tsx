'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { RoomState } from '@/types/room';
import { serverNow } from '@/lib/sync';

type Props = {
  state: RoomState | null;
  clockOffsetMs: number | null;
  duration: number;
};

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function send(body: object) {
  await fetch('/api/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function TransportControls({ state, clockOffsetMs, duration }: Props) {
  const [displayPos, setDisplayPos] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  useEffect(() => {
    if (!state || clockOffsetMs === null) return;
    const tick = () => {
      const pos = state.isPlaying
        ? state.positionAtStart + (serverNow(clockOffsetMs) - state.startedAt) / 1000
        : state.positionAtStart;
      setDisplayPos(Math.max(0, pos));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state, clockOffsetMs]);

  const disabled = !state?.videoId;
  const current = scrubbing ?? displayPos;
  const max = duration > 0 ? duration : 1;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            if (!state) return;
            if (state.isPlaying) {
              send({ action: 'pause', position: displayPos });
            } else {
              send({ action: 'play' });
            }
          }}
        >
          {state?.isPlaying ? 'Pause' : 'Play'}
        </Button>
        <span className="font-mono text-sm tabular-nums text-neutral-400">
          {formatTime(current)} / {formatTime(duration)}
        </span>
      </div>
      <Slider
        min={0}
        max={max}
        step={0.1}
        value={[current]}
        disabled={disabled}
        onValueChange={(v) => {
          const next = Array.isArray(v) ? v[0] : v;
          setScrubbing(next);
        }}
        onValueCommitted={(v) => {
          const next = Array.isArray(v) ? v[0] : v;
          setScrubbing(null);
          send({ action: 'seek', position: next });
        }}
      />
    </div>
  );
}
