'use client';

import { useCallback, useRef, useState } from 'react';
import { Player } from '@/components/player';
import { JoinOverlay } from '@/components/join-overlay';
import { RoomHeader } from '@/components/room-header';
import { SyncIndicator } from '@/components/sync-indicator';
import { PlaylistImport } from '@/components/playlist-import';
import { PlaylistControls } from '@/components/playlist-controls';
import { PlaylistSeekBar } from '@/components/playlist-seekbar';
import { PlaylistTracklist } from '@/components/playlist-tracklist';
import { useServerClock } from '@/hooks/use-server-clock';
import { usePlaylistSync } from '@/hooks/use-playlist-sync';

export default function PlaylistPage() {
  const playerRef = useRef<YT.Player | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const clock = useServerClock();
  const clockOffsetMs = clock?.offsetMs ?? null;

  const getPlayer = useCallback(() => playerRef.current, []);
  const handlePlayerReady = useCallback((player: YT.Player) => {
    playerRef.current = player;
    setPlayerReady(true);
  }, []);

  const { state, listenerCount, driftMs, index, offsetS, ended } = usePlaylistSync({
    clockOffsetMs,
    getPlayer,
    playerReady,
    audioUnlocked,
  });

  const tracks = state?.tracks ?? [];
  const hasPlaylist = tracks.length > 0;
  const currentTrack = tracks[index];

  const handleJoin = () => {
    const player = playerRef.current;
    if (player) {
      player.playVideo();
      player.pauseVideo();
    }
    setAudioUnlocked(true);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <RoomHeader listenerCount={listenerCount} />

      <Player onReady={handlePlayerReady} />

      <PlaylistImport />

      {hasPlaylist && (
        <>
          <div className="flex flex-col gap-1 text-center">
            <span className="truncate text-sm font-medium text-white">
              {ended ? 'Playlist finished' : currentTrack?.title ?? ''}
            </span>
            <span className="text-xs text-neutral-500">
              Track {Math.min(index + 1, tracks.length)} / {tracks.length}
            </span>
          </div>

          <PlaylistControls isPlaying={!!state?.isPlaying && !ended} hasPlaylist={hasPlaylist} />

          <PlaylistSeekBar state={state} clockOffsetMs={clockOffsetMs} />

          <PlaylistTracklist tracks={tracks} currentIndex={index} offsetS={offsetS} />
        </>
      )}

      <div className="flex flex-col gap-1 text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
        <span className="truncate">
          {hasPlaylist ? '' : 'Paste a YouTube playlist URL to start the party 🎵'}
        </span>
        <SyncIndicator driftMs={driftMs} rttMs={clock?.rttMs ?? null} />
      </div>

      {!audioUnlocked && <JoinOverlay onJoin={handleJoin} />}
    </main>
  );
}
