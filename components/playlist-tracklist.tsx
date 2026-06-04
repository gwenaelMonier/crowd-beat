'use client';

import type { PlaylistTrack } from '@/types/room';

type Props = {
  tracks: PlaylistTrack[];
  currentIndex: number;
  offsetS: number;
};

function fmt(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function PlaylistTracklist({ tracks, currentIndex, offsetS }: Props) {
  async function jumpTo(index: number) {
    await fetch('/api/playlist/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'seekToTrack', index }),
    });
  }

  return (
    <ul className="flex flex-col divide-y divide-neutral-800 overflow-hidden rounded-lg border border-neutral-800">
      {tracks.map((track, i) => {
        const isCurrent = i === currentIndex;
        const progress = isCurrent ? Math.min(100, (offsetS / track.durationS) * 100) : 0;
        return (
          <li key={`${track.videoId}-${i}`} className="relative">
            {isCurrent && (
              <div
                className="absolute inset-y-0 left-0 bg-neutral-800/60"
                style={{ width: `${progress}%` }}
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={() => jumpTo(i)}
              className={`relative flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-900 ${
                isCurrent ? 'font-medium text-white' : 'text-neutral-400'
              }`}
            >
              <span className="w-6 shrink-0 tabular-nums text-neutral-500">{i + 1}</span>
              <span className="flex-1 truncate">{track.title}</span>
              <span className="shrink-0 tabular-nums text-neutral-500">{fmt(track.durationS)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
