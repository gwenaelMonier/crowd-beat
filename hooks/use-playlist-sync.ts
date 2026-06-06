'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaylistState, PlaylistServerEvent } from '@/types/room';
import { serverNow } from '@/lib/sync';
import {
  resolvePlaylistPosition,
  isFatalPlayerError,
  skipActionForUnavailable,
} from '@/lib/playlist-logic';
import { decideDriftCorrection } from '@/lib/sync-logic';

const TICK_MS = 500;

export type UsePlaylistSyncParams = {
  clockOffsetMs: number | null;
  getPlayer: () => YT.Player | null;
  playerReady: boolean;
  audioUnlocked: boolean;
};

export type UsePlaylistSyncResult = {
  state: PlaylistState | null;
  listenerCount: number;
  driftMs: number;
  index: number;
  offsetS: number;
  ended: boolean;
  /** Title of a track YouTube refused to play (region/embed block); we skip it. */
  unavailableTitle: string | null;
  /** Pass to <Player onError> — auto-advances the shared timeline past a dead video. */
  handlePlayerError: (code: number) => void;
};

export function usePlaylistSync(params: UsePlaylistSyncParams): UsePlaylistSyncResult {
  const { clockOffsetMs, getPlayer, playerReady, audioUnlocked } = params;
  const [state, setState] = useState<PlaylistState | null>(null);
  const [listenerCount, setListenerCount] = useState(0);
  const [driftMs, setDriftMs] = useState(0);
  const [resolved, setResolved] = useState({ index: 0, offsetS: 0, ended: false });
  const [unavailableTitle, setUnavailableTitle] = useState<string | null>(null);
  const stateRef = useRef<PlaylistState | null>(null);
  const currentTrackRef = useRef<{ index: number; videoId: string } | null>(null);
  // Track we've already broadcast a skip for, so repeated error events (and other
  // clients' errors landing back as state) don't post the skip again.
  const handledErrorKeyRef = useRef<string | null>(null);
  const unavailableIndexRef = useRef<number | null>(null);

  stateRef.current = state;

  // When YouTube refuses the current video (removed, embedding disabled, or a
  // region/licence block that the Data API doesn't expose), advance the shared
  // timeline past it. A client can't skip locally without desyncing, so the skip
  // is global; the absolute-index jump keeps concurrent skips idempotent.
  const handlePlayerError = useCallback((code: number) => {
    if (!isFatalPlayerError(code)) return;
    const s = stateRef.current;
    const loaded = currentTrackRef.current;
    if (!s || !loaded) return;
    const key = `${loaded.index}:${loaded.videoId}`;
    if (handledErrorKeyRef.current === key) return;
    handledErrorKeyRef.current = key;
    unavailableIndexRef.current = loaded.index;
    setUnavailableTitle(s.tracks[loaded.index]?.title ?? null);
    void fetch('/api/playlist/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(skipActionForUnavailable(loaded.index, s.tracks.length)),
    });
  }, []);

  // Subscribe to playlist room events.
  useEffect(() => {
    const es = new EventSource('/api/playlist/events');
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as PlaylistServerEvent;
        if (event.type === 'state') setState(event.state);
        else if (event.type === 'listeners') setListenerCount(event.count);
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, []);

  // Drive the player from the timeline.
  useEffect(() => {
    if (!playerReady || !audioUnlocked || clockOffsetMs === null) return;

    let pendingSeekTarget: number | null = null;
    let seekIssuedAt: number | null = null;
    let seekLatencyMs = 0;

    const id = setInterval(() => {
      const s = stateRef.current;
      const player = getPlayer();
      if (!s || !player || s.tracks.length === 0) return;

      const now = serverNow(clockOffsetMs);
      const pos = resolvePlaylistPosition(s, now);
      setResolved(pos);

      // Once the timeline has moved off a track we flagged unavailable (or the
      // playlist ended because its last track was the dead one), drop the notice.
      if (
        unavailableIndexRef.current !== null &&
        (pos.index !== unavailableIndexRef.current || pos.ended)
      ) {
        unavailableIndexRef.current = null;
        setUnavailableTitle(null);
      }

      const track = s.tracks[pos.index];
      if (!track) return;

      // New track (auto-advance, seek, or first load): load it at the right offset.
      // Identify the track by (index, videoId) so a repeated videoId at a different
      // position still counts as a track change.
      const current = currentTrackRef.current;
      if (current?.index !== pos.index || current?.videoId !== track.videoId) {
        setDriftMs(0);
        pendingSeekTarget = null;
        seekIssuedAt = null;
        // Fresh load → allow this track to report (and skip on) its own error.
        handledErrorKeyRef.current = null;
        player.loadVideoById(track.videoId, Math.max(0, pos.offsetS));
        currentTrackRef.current = { index: pos.index, videoId: track.videoId };
        return;
      }

      const playerState = player.getPlayerState();
      const currentTime = player.getCurrentTime();
      const isPlaying = playerState === YT.PlayerState.PLAYING;

      // Paused or playlist finished: ensure the player is paused.
      if (!s.isPlaying || pos.ended) {
        if (isPlaying) player.pauseVideo();
        return;
      }

      // Should be playing but isn't: start at the expected offset.
      if (!isPlaying) {
        player.seekTo(pos.offsetS, true);
        player.playVideo();
        return;
      }

      // Adaptive pre-buffer: wait for an in-flight hard seek to land.
      if (pendingSeekTarget !== null) {
        if (currentTime >= pendingSeekTarget - 0.1) {
          if (seekIssuedAt !== null) {
            const measured = Date.now() - seekIssuedAt;
            seekLatencyMs =
              seekLatencyMs === 0 ? measured : Math.round(seekLatencyMs * 0.5 + measured * 0.5);
          }
          pendingSeekTarget = null;
          seekIssuedAt = null;
        } else {
          return;
        }
      }

      setDriftMs(Math.round((pos.offsetS - currentTime) * 1000));

      const decision = decideDriftCorrection(pos.offsetS, currentTime);
      if (decision.kind === 'seek') {
        const adjusted = decision.to + seekLatencyMs / 1000;
        pendingSeekTarget = adjusted;
        seekIssuedAt = Date.now();
        player.seekTo(adjusted, true);
        return;
      }
      if (decision.kind === 'setRate') {
        player.setPlaybackRate(decision.rate);
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [playerReady, audioUnlocked, clockOffsetMs, getPlayer]);

  return {
    state,
    listenerCount,
    driftMs,
    index: resolved.index,
    offsetS: resolved.offsetS,
    ended: resolved.ended,
    unavailableTitle,
    handlePlayerError,
  };
}
