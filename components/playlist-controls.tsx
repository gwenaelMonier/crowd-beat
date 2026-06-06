'use client';

import { SkipBack, SkipForward, Play, Pause, Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlaylistAction } from '@/types/room';

type Props = { isPlaying: boolean; hasPlaylist: boolean; shuffle: boolean };

async function send(action: PlaylistAction) {
  await fetch('/api/playlist/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action),
  });
}

export function PlaylistControls({ isPlaying, hasPlaylist, shuffle }: Props) {
  return (
    <div className="flex items-center justify-center gap-2">
      <Button
        variant={shuffle ? 'default' : 'secondary'}
        size="icon"
        disabled={!hasPlaylist}
        aria-pressed={shuffle}
        aria-label="Shuffle"
        onClick={() => send({ action: 'shuffle', enabled: !shuffle })}
      >
        <Shuffle className="size-5" />
      </Button>
      <Button variant="secondary" size="icon" disabled={!hasPlaylist} onClick={() => send({ action: 'prev' })} aria-label="Previous track">
        <SkipBack className="size-5" />
      </Button>
      <Button size="icon" disabled={!hasPlaylist} onClick={() => send({ action: isPlaying ? 'pause' : 'play' })} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
      </Button>
      <Button variant="secondary" size="icon" disabled={!hasPlaylist} onClick={() => send({ action: 'next' })} aria-label="Next track">
        <SkipForward className="size-5" />
      </Button>
    </div>
  );
}
