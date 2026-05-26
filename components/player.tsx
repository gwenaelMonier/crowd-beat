'use client';

import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi } from '@/lib/youtube-iframe';

type Props = {
  onReady: (player: YT.Player) => void;
  onStateChange?: (player: YT.Player, playerState: number) => void;
};

export function Player({ onReady, onStateChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  const [mounted, setMounted] = useState(false);

  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;
    let destroyed = false;

    loadYouTubeApi().then((YT) => {
      if (destroyed || !containerRef.current) return;
      const div = document.createElement('div');
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(div);
      playerRef.current = new YT.Player(div, {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          vq: 'tiny',
        },
        events: {
          onReady: (e) => {
            onReady(e.target);
          },
          onStateChange: (e) => onStateChangeRef.current?.(e.target, e.data),
        },
      });
    });

    return () => {
      destroyed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
