'use client';

import { Button } from '@/components/ui/button';

type Props = { onJoin: () => void };

export function JoinOverlay({ onJoin }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 rounded-xl border border-neutral-800 bg-neutral-950 p-10 text-center">
        <h2 className="text-2xl font-semibold">🔊 Collective Speaker</h2>
        <p className="max-w-sm text-neutral-400">
          Everyone here listens to the same YouTube audio, in perfect sync. Click below to
          join.
        </p>
        <Button size="lg" onClick={onJoin}>
          Click to join
        </Button>
      </div>
    </div>
  );
}
