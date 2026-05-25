'use client';

import { useEffect, useRef, useState } from 'react';
import type { RoomState, ServerEvent } from '@/types/room';
import { serverNow } from '@/lib/sync';
import {
  decideOnStateChange,
  decideOnTick,
  expectedPosition,
} from '@/lib/sync-logic';

const TICK_MS = 500;
const SEEK_COOLDOWN_MS = 2000;
const PRE_BUFFER_S = 0.5;
const MAX_CATCHUP_RATE = 1.15;

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

function applyDecision(
  player: YT.Player,
  decision: ReturnType<typeof decideOnStateChange>,
): void {
  switch (decision.kind) {
    case 'noop':
      return;
    case 'play':
      player.seekTo(decision.seekTo, true);
      player.playVideo();
      return;
    case 'pause':
      player.pauseVideo();
      return;
    case 'seek':
      player.seekTo(decision.to, true);
      return;
    case 'setRate':
      player.setPlaybackRate(decision.rate);
      return;
  }
}

export function useRoomSync(params: UseRoomSyncParams): UseRoomSyncResult {
  const { clockOffsetMs, getPlayer, playerReady, audioUnlocked } = params;
  const [state, setState] = useState<RoomState | null>(null);
  const [listenerCount, setListenerCount] = useState(0);
  const [driftMs, setDriftMs] = useState(0);
  const stateRef = useRef<RoomState | null>(null);
  const currentVideoRef = useRef<string | null>(null);
  const lastHardSeekRef = useRef(0);

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
      lastHardSeekRef.current = 0;
      return;
    }

    if (!state.videoId) return;

    const decision = decideOnStateChange(
      state,
      player.getPlayerState(),
      serverNow(clockOffsetMs),
    );
    applyDecision(player, decision);
  }, [state, playerReady, audioUnlocked, clockOffsetMs, getPlayer]);

  useEffect(() => {
    if (!playerReady || !audioUnlocked || clockOffsetMs === null) return;
    const id = setInterval(() => {
      const s = stateRef.current;
      const player = getPlayer();
      if (!s || !player) return;

      const now = Date.now();
      const decision = decideOnTick(
        s,
        player.getPlayerState(),
        player.getCurrentTime(),
        serverNow(clockOffsetMs),
      );

      if (s.videoId && s.isPlaying && player.getPlayerState() === YT.PlayerState.PLAYING) {
        const expected = expectedPosition(s, serverNow(clockOffsetMs));
        setDriftMs(Math.round((expected - player.getCurrentTime()) * 1000));
      }

      if (decision.kind === 'seek') {
        if (now - lastHardSeekRef.current < SEEK_COOLDOWN_MS) {
          player.setPlaybackRate(MAX_CATCHUP_RATE);
        } else {
          lastHardSeekRef.current = now;
          player.seekTo(Math.max(0, decision.to - PRE_BUFFER_S), true);
          player.setPlaybackRate(MAX_CATCHUP_RATE);
        }
      } else {
        applyDecision(player, decision);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playerReady, audioUnlocked, clockOffsetMs, getPlayer]);

  return { state, listenerCount, driftMs };
}
