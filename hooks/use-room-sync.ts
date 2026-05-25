'use client';

import { useEffect, useRef, useState } from 'react';
import type { RoomState, ServerEvent } from '@/types/room';
import { serverNow } from '@/lib/sync';

const HARD_CORRECTION_S = 1.0;
const SOFT_CORRECTION_S = 0.03;
const TICK_MS = 500;
const MAX_RATE_DELTA = 0.15;
const RATE_GAIN = 0.5;

export type UseRoomSyncParams = {
  clockOffsetMs: number | null;
  getPlayer: () => YT.Player | null;
  playerReady: boolean;
  audioUnlocked: boolean;
};

export type UseRoomSyncResult = {
  state: RoomState | null;
  listenerCount: number;
  driftMs: number;
};

function expectedPosition(state: RoomState, nowMs: number): number {
  if (!state.isPlaying) return state.positionAtStart;
  return state.positionAtStart + (nowMs - state.startedAt) / 1000;
}

export function useRoomSync(params: UseRoomSyncParams): UseRoomSyncResult {
  const { clockOffsetMs, getPlayer, playerReady, audioUnlocked } = params;
  const [state, setState] = useState<RoomState | null>(null);
  const [listenerCount, setListenerCount] = useState(0);
  const [driftMs, setDriftMs] = useState(0);
  const stateRef = useRef<RoomState | null>(null);
  const currentVideoRef = useRef<string | null>(null);

  stateRef.current = state;

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as ServerEvent;
        if (event.type === 'state') setState(event.state);
        else if (event.type === 'listeners') setListenerCount(event.count);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!playerReady || !audioUnlocked || clockOffsetMs === null) return;
    const player = getPlayer();
    if (!player || !state) return;

    if (state.videoId && state.videoId !== currentVideoRef.current) {
      const startPos = expectedPosition(state, serverNow(clockOffsetMs));
      player.loadVideoById(state.videoId, Math.max(0, startPos));
      currentVideoRef.current = state.videoId;
      return;
    }

    if (!state.videoId) return;

    if (state.isPlaying) {
      const target = expectedPosition(state, serverNow(clockOffsetMs));
      if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
        player.seekTo(target, true);
        player.playVideo();
      }
    } else {
      if (player.getPlayerState() !== YT.PlayerState.PAUSED) {
        player.pauseVideo();
      }
    }
  }, [state, playerReady, audioUnlocked, clockOffsetMs, getPlayer]);

  useEffect(() => {
    if (!playerReady || !audioUnlocked || clockOffsetMs === null) return;
    const id = setInterval(() => {
      const s = stateRef.current;
      const player = getPlayer();
      if (!s || !player || !s.videoId || !s.isPlaying) return;
      if (player.getPlayerState() !== YT.PlayerState.PLAYING) return;

      const expected = expectedPosition(s, serverNow(clockOffsetMs));
      const actual = player.getCurrentTime();
      const drift = expected - actual;
      setDriftMs(Math.round(drift * 1000));

      const abs = Math.abs(drift);
      if (abs > HARD_CORRECTION_S) {
        player.seekTo(expected, true);
        player.setPlaybackRate(1);
      } else if (abs > SOFT_CORRECTION_S) {
        const delta = Math.min(MAX_RATE_DELTA, abs * RATE_GAIN);
        player.setPlaybackRate(drift > 0 ? 1 + delta : 1 - delta);
      } else {
        player.setPlaybackRate(1);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playerReady, audioUnlocked, clockOffsetMs, getPlayer]);

  return { state, listenerCount, driftMs };
}
