'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Player } from '@/components/player';
import { LoadInput } from '@/components/load-input';
import { TransportControls } from '@/components/transport-controls';
import { SyncIndicator } from '@/components/sync-indicator';
import { RoomHeader } from '@/components/room-header';
import { JoinOverlay } from '@/components/join-overlay';
import { useServerClock } from '@/hooks/use-server-clock';
import { useRoomSync } from '@/hooks/use-room-sync';
import type { RoomState } from '@/types/room';

export default function HomePage() {
  const playerRef = useRef<YT.Player | null>(null);
  const stateRef = useRef<RoomState | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [duration, setDuration] = useState(0);

  const clock = useServerClock();
  const clockOffsetMs = clock?.offsetMs ?? null;

  const getPlayer = useCallback(() => playerRef.current, []);

  const handlePlayerReady = useCallback((player: YT.Player) => {
    playerRef.current = player;
    setPlayerReady(true);
  }, []);

  const handlePlayerStateChange = useCallback(
    (player: YT.Player, playerState: number) => {
      const s = stateRef.current;
      if (!s) return;
      if (!s.isPlaying && playerState === YT.PlayerState.PLAYING) {
        player.pauseVideo();
      }
    },
    [],
  );

  const { state, listenerCount, driftMs } = useRoomSync({
    clockOffsetMs,
    getPlayer,
    playerReady,
    audioUnlocked,
  });

  stateRef.current = state;

  useEffect(() => {
    if (!playerReady || !state?.videoId) return;
    const id = setInterval(() => {
      const d = playerRef.current?.getDuration() ?? 0;
      if (d > 0) setDuration(d);
    }, 500);
    return () => clearInterval(id);
  }, [playerReady, state?.videoId]);

  const handleJoin = () => {
    const player = playerRef.current;
    if (player) {
      player.playVideo();
      player.pauseVideo();
    }
    setAudioUnlocked(true);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <RoomHeader listenerCount={listenerCount} />

      <Player onReady={handlePlayerReady} onStateChange={handlePlayerStateChange} />

      <LoadInput />

      <TransportControls
        state={state}
        clockOffsetMs={clockOffsetMs}
        duration={duration}
      />

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          {state?.videoId
            ? `Now playing: ${state.videoId}`
            : 'Paste a YouTube URL to start the party 🎵'}
        </span>
        <SyncIndicator driftMs={driftMs} rttMs={clock?.rttMs ?? null} />
      </div>

      {!audioUnlocked && <JoinOverlay onJoin={handleJoin} />}
    </main>
  );
}
