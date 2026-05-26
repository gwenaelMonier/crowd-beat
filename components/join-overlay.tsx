'use client';

import { Button } from '@/components/ui/button';

type Props = { onJoin: () => void };

export function JoinOverlay({ onJoin }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex h-dvh items-end justify-center overflow-hidden bg-black/80 p-4 backdrop-blur-sm sm:items-center">
      <div className="flex max-w-sm flex-col items-center gap-6 rounded-xl border border-neutral-800 bg-neutral-950 p-6 text-center sm:p-10">
        <h2 className="text-2xl font-semibold">🔊 Collective Speaker</h2>
        <p className="text-neutral-400">
          Everyone here listens to the same YouTube audio, in perfect sync. Tap below to
          join.
        </p>
        <Button className="w-full sm:w-auto" size="lg" onClick={onJoin}>
          Click to join
        </Button>
      </div>
    </div>
  );
}
