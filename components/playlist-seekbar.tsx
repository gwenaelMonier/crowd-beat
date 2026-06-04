'use client';

import { useEffect, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import type { PlaylistState } from '@/types/room';
import { serverNow } from '@/lib/sync';
import { resolvePlaylistPosition, trackStartOffset } from '@/lib/playlist-logic';

type Props = {
  state: PlaylistState | null;
  clockOffsetMs: number | null;
};

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function send(body: object) {
  await fetch('/api/playlist/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function PlaylistSeekBar({ state, clockOffsetMs }: Props) {
  const [resolved, setResolved] = useState({ index: 0, offsetS: 0, ended: false });
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  useEffect(() => {
    if (!state || clockOffsetMs === null) return;
    const tick = () => setResolved(resolvePlaylistPosition(state, serverNow(clockOffsetMs)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state, clockOffsetMs]);

  const tracks = state?.tracks ?? [];
  const track = tracks[resolved.index];
  const disabled = !track;
  const trackDuration = track && track.durationS > 0 ? track.durationS : 1;
  const current = scrubbing ?? Math.min(Math.max(0, resolved.offsetS), trackDuration);

  return (
    <div className="flex w-full flex-col gap-1">
      <Slider
        min={0}
        max={trackDuration}
        step={0.1}
        value={[current]}
        disabled={disabled}
        onValueChange={(v) => {
          const next = Array.isArray(v) ? v[0] : v;
          setScrubbing(next);
        }}
        onValueCommitted={(v) => {
          const within = Array.isArray(v) ? v[0] : v;
          setScrubbing(null);
          if (!track) return;
          const position = trackStartOffset(tracks, resolved.index) + within;
          send({ action: 'seek', position });
        }}
      />
      <div className="flex justify-between font-mono text-xs tabular-nums text-neutral-500">
        <span>{formatTime(current)}</span>
        <span>{formatTime(trackDuration)}</span>
      </div>
    </div>
  );
}
