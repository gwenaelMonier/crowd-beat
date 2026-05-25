# Collective Speaker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-room website where every visitor listens to the same YouTube video in tight synchronization (~50-100 ms drift), with anyone able to load/play/pause/seek.

**Architecture:** Next.js 16 App Router on Vercel (Fluid Compute). Shared playback state in Upstash Redis (Vercel Marketplace). Client → server commands via POST. Server → clients via SSE fed by Redis pub/sub. Sub-second sync via NTP-style clock offset + periodic drift correction (seek + playbackRate nudge).

**Tech Stack:** TypeScript, Next.js 16 (App Router), React 19, Tailwind v4, shadcn/ui, Upstash Redis, YouTube IFrame Player API.

**Note on tests:** Per spec, no automated tests in v1. Verification is manual (steps included in each task).

---

## Task 1: Scaffold the Next.js project

**Files:**
- Create: entire project at repo root

- [ ] **Step 1: Run scaffold**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir=false --import-alias="@/*" --eslint --turbopack --yes
```

Expected: project files created (`package.json`, `app/`, `tsconfig.json`, etc.) without prompts.

- [ ] **Step 2: Install runtime deps**

Run:
```bash
pnpm add @upstash/redis
```

(If pnpm not present, fallback to `npm install @upstash/redis`.)

- [ ] **Step 3: Init shadcn/ui**

Run:
```bash
pnpm dlx shadcn@latest init --yes --base-color=neutral
pnpm dlx shadcn@latest add button input slider --yes
```

- [ ] **Step 4: Verify dev server boots**

Run: `pnpm dev` (kill after 5s)
Expected: "Ready in Xms" with no errors. Default page renders at http://localhost:3000.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with Tailwind and shadcn/ui"
```

---

## Task 2: Provision Upstash Redis and wire env

**Files:**
- Create: `.env.local`
- Modify: `.env.example`

- [ ] **Step 1: Provision Upstash Redis via Vercel Marketplace**

Tell the user: "I need an Upstash Redis instance. Either (a) create one at https://console.upstash.com (free Redis DB, copy REST URL + REST TOKEN), or (b) link this repo to a Vercel project and run `vercel env pull .env.local` after adding the Upstash integration."

Wait for the user to supply `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, OR confirm they've populated `.env.local` themselves.

- [ ] **Step 2: Write `.env.example`**

Create file with content:
```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

- [ ] **Step 3: Verify `.env.local` exists with both vars set**

Run: `grep -c UPSTASH .env.local`
Expected: `2`

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "Document Upstash Redis env vars"
```

---

## Task 3: Define shared types

**Files:**
- Create: `types/room.ts`

- [ ] **Step 1: Write types**

```ts
// types/room.ts
export type RoomState = {
  videoId: string | null;
  isPlaying: boolean;
  startedAt: number;       // server ms timestamp when current play started
  positionAtStart: number; // video position (seconds) at startedAt
  updatedAt: number;
};

export type ControlAction =
  | { action: 'load'; videoId: string }
  | { action: 'play' }
  | { action: 'pause'; position: number }
  | { action: 'seek'; position: number };

export type ServerEvent =
  | { type: 'state'; state: RoomState }
  | { type: 'listeners'; count: number };

export const ROOM_KEY = 'room:global';
export const ROOM_CHANNEL = 'room:global:events';
export const LISTENER_PREFIX = 'listeners:';
export const LISTENER_TTL_SECONDS = 15;
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add types/room.ts
git commit -m "Add shared room types"
```

---

## Task 4: Redis client + room helpers

**Files:**
- Create: `lib/redis.ts`
- Create: `lib/room.ts`

- [ ] **Step 1: Write `lib/redis.ts`**

```ts
// lib/redis.ts
import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();
```

- [ ] **Step 2: Write `lib/room.ts`**

```ts
// lib/room.ts
import { redis } from './redis';
import { ROOM_KEY, ROOM_CHANNEL, type RoomState, type ServerEvent } from '@/types/room';

const INITIAL_STATE: RoomState = {
  videoId: null,
  isPlaying: false,
  startedAt: 0,
  positionAtStart: 0,
  updatedAt: 0,
};

export async function getState(): Promise<RoomState> {
  const stored = await redis.get<RoomState>(ROOM_KEY);
  return stored ?? INITIAL_STATE;
}

export async function setState(state: RoomState): Promise<void> {
  await redis.set(ROOM_KEY, state);
}

export async function publish(event: ServerEvent): Promise<void> {
  await redis.publish(ROOM_CHANNEL, JSON.stringify(event));
}

export async function setStateAndPublish(state: RoomState): Promise<void> {
  await setState(state);
  await publish({ type: 'state', state });
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/redis.ts lib/room.ts
git commit -m "Add Redis client and room state helpers"
```

---

## Task 5: YouTube URL parser

**Files:**
- Create: `lib/youtube.ts`

- [ ] **Step 1: Write parser**

```ts
// lib/youtube.ts

const ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (ID_REGEX.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1);
      return ID_REGEX.test(id) ? id : null;
    }
    if (url.hostname.endsWith('youtube.com')) {
      if (url.pathname === '/watch') {
        const v = url.searchParams.get('v');
        return v && ID_REGEX.test(v) ? v : null;
      }
      if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.split('/')[2] ?? '';
        return ID_REGEX.test(id) ? id : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}
```

- [ ] **Step 2: Quick manual verify**

Run:
```bash
pnpm exec tsx -e "import { parseVideoId } from './lib/youtube'; console.log([parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), parseVideoId('https://youtu.be/dQw4w9WgXcQ'), parseVideoId('dQw4w9WgXcQ'), parseVideoId('garbage')])"
```
Expected: `['dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ', null]`

(If `tsx` not installed, skip this verification — the type-check in the next step is sufficient.)

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/youtube.ts
git commit -m "Add YouTube URL/ID parser"
```

---

## Task 6: `/api/time` route

**Files:**
- Create: `app/api/time/route.ts`

- [ ] **Step 1: Write route**

```ts
// app/api/time/route.ts
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ now: Date.now() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 2: Manual verify**

Run dev server in background: `pnpm dev` (background).
Then: `curl -s http://localhost:3000/api/time`
Expected: `{"now":<13-digit-number>}`.
Kill dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/time/route.ts
git commit -m "Add /api/time endpoint for clock sync"
```

---

## Task 7: `/api/state` route

**Files:**
- Create: `app/api/state/route.ts`

- [ ] **Step 1: Write route**

```ts
// app/api/state/route.ts
import { getState } from '@/lib/room';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getState();
  return Response.json(state, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 2: Manual verify**

Run `pnpm dev` in background. Then: `curl -s http://localhost:3000/api/state`
Expected: JSON with `videoId: null, isPlaying: false, ...`. Kill dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/state/route.ts
git commit -m "Add /api/state snapshot endpoint"
```

---

## Task 8: `/api/control` route

**Files:**
- Create: `app/api/control/route.ts`

- [ ] **Step 1: Write route**

```ts
// app/api/control/route.ts
import { getState, setStateAndPublish } from '@/lib/room';
import type { ControlAction, RoomState } from '@/types/room';
import { parseVideoId } from '@/lib/youtube';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as ControlAction;
  const current = await getState();
  const now = Date.now();
  let next: RoomState;

  switch (body.action) {
    case 'load': {
      const videoId = parseVideoId(body.videoId);
      if (!videoId) {
        return Response.json({ error: 'Invalid videoId' }, { status: 400 });
      }
      next = {
        videoId,
        isPlaying: true,
        startedAt: now,
        positionAtStart: 0,
        updatedAt: now,
      };
      break;
    }
    case 'play': {
      if (!current.videoId) {
        return Response.json({ error: 'No video loaded' }, { status: 400 });
      }
      if (current.isPlaying) {
        next = current;
      } else {
        next = { ...current, isPlaying: true, startedAt: now, updatedAt: now };
      }
      break;
    }
    case 'pause': {
      next = {
        ...current,
        isPlaying: false,
        positionAtStart: body.position,
        startedAt: now,
        updatedAt: now,
      };
      break;
    }
    case 'seek': {
      next = {
        ...current,
        startedAt: now,
        positionAtStart: body.position,
        updatedAt: now,
      };
      break;
    }
    default:
      return Response.json({ error: 'Unknown action' }, { status: 400 });
  }

  await setStateAndPublish(next);
  return Response.json(next);
}
```

- [ ] **Step 2: Manual verify**

Run `pnpm dev` in background. Then:
```bash
curl -s -X POST http://localhost:3000/api/control \
  -H 'content-type: application/json' \
  -d '{"action":"load","videoId":"dQw4w9WgXcQ"}'
```
Expected: JSON with `videoId: "dQw4w9WgXcQ", isPlaying: true`. Then:
```bash
curl -s http://localhost:3000/api/state
```
Expected: same state echoed. Kill dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/control/route.ts
git commit -m "Add /api/control command endpoint"
```

---

## Task 9: `/api/events` SSE route with listener tracking

**Files:**
- Create: `app/api/events/route.ts`

- [ ] **Step 1: Write route**

```ts
// app/api/events/route.ts
import { redis } from '@/lib/redis';
import { getState, publish } from '@/lib/room';
import {
  LISTENER_PREFIX,
  LISTENER_TTL_SECONDS,
  ROOM_CHANNEL,
  type ServerEvent,
} from '@/types/room';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEARTBEAT_MS = 10_000;
const CONNECTION_MAX_MS = 4 * 60 * 1000;
const STATE_POLL_MS = 1_000;

async function countListeners(): Promise<number> {
  let cursor = '0';
  let total = 0;
  do {
    const [next, keys] = await redis.scan(cursor, {
      match: `${LISTENER_PREFIX}*`,
      count: 200,
    });
    cursor = next;
    total += keys.length;
  } while (cursor !== '0');
  return total;
}

export async function GET() {
  const connId = crypto.randomUUID();
  const listenerKey = `${LISTENER_PREFIX}${connId}`;
  await redis.set(listenerKey, '1', { ex: LISTENER_TTL_SECONDS });

  const encoder = new TextEncoder();
  let closed = false;
  let lastStateJson = '';
  let lastListenerCount = -1;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ServerEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const initialState = await getState();
      lastStateJson = JSON.stringify(initialState);
      send({ type: 'state', state: initialState });

      const initialCount = await countListeners();
      lastListenerCount = initialCount;
      send({ type: 'listeners', count: initialCount });

      const heartbeat = setInterval(async () => {
        try {
          await redis.set(listenerKey, '1', { ex: LISTENER_TTL_SECONDS });
          const count = await countListeners();
          if (count !== lastListenerCount) {
            lastListenerCount = count;
            send({ type: 'listeners', count });
          }
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // ignore transient errors
        }
      }, HEARTBEAT_MS);

      // Poll Redis for state changes. (Upstash REST has no native subscribe,
      // so we poll the room key once per second.)
      const poll = setInterval(async () => {
        try {
          const state = await getState();
          const json = JSON.stringify(state);
          if (json !== lastStateJson) {
            lastStateJson = json;
            send({ type: 'state', state });
          }
        } catch {
          // ignore
        }
      }, STATE_POLL_MS);

      const closeAll = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(poll);
        try {
          await redis.del(listenerKey);
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      setTimeout(closeAll, CONNECTION_MAX_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

**Important note for the implementer:** The original spec used Redis pub/sub. Upstash's REST client used here doesn't support `subscribe`. We use 1-second polling of the room key instead — still well within the sync budget because clients also run client-side drift correction every 2s. Keep `publish` calls elsewhere (they're harmless and forward-compatible if we later swap to a TCP client).

- [ ] **Step 2: Manual verify**

Run `pnpm dev` in background. Then:
```bash
curl -N -s http://localhost:3000/api/events &
CURL_PID=$!
sleep 2
curl -s -X POST http://localhost:3000/api/control -H 'content-type: application/json' -d '{"action":"pause","position":42}' > /dev/null
sleep 2
kill $CURL_PID
```
Expected: curl output contains a `data: {"type":"state",...}` line with `positionAtStart:42`. Kill dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/events/route.ts
git commit -m "Add SSE events endpoint with listener tracking"
```

---

## Task 10: Client clock-sync utility

**Files:**
- Create: `lib/sync.ts`

- [ ] **Step 1: Write module**

```ts
// lib/sync.ts

export type ClockOffset = { offsetMs: number; rttMs: number };

export async function measureClockOffset(samples = 5): Promise<ClockOffset> {
  const results: ClockOffset[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const res = await fetch('/api/time', { cache: 'no-store' });
    const { now: tServer } = (await res.json()) as { now: number };
    const t1 = Date.now();
    const rttMs = t1 - t0;
    const offsetMs = tServer + rttMs / 2 - t1;
    results.push({ offsetMs, rttMs });
  }
  results.sort((a, b) => a.rttMs - b.rttMs);
  return results[0];
}

export function serverNow(offsetMs: number): number {
  return Date.now() + offsetMs;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/sync.ts
git commit -m "Add client clock-offset measurement"
```

---

## Task 11: `useServerClock` hook

**Files:**
- Create: `hooks/use-server-clock.ts`

- [ ] **Step 1: Write hook**

```ts
// hooks/use-server-clock.ts
'use client';

import { useEffect, useState } from 'react';
import { measureClockOffset } from '@/lib/sync';

const RESYNC_INTERVAL_MS = 30_000;

export function useServerClock(): { offsetMs: number; rttMs: number } | null {
  const [clock, setClock] = useState<{ offsetMs: number; rttMs: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const result = await measureClockOffset();
        if (!cancelled) setClock(result);
      } catch {
        // keep last value
      }
    };
    sync();
    const id = setInterval(sync, RESYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return clock;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-server-clock.ts
git commit -m "Add useServerClock hook"
```

---

## Task 12: YouTube IFrame Player API loader + types

**Files:**
- Create: `lib/youtube-iframe.ts`
- Create: `types/youtube.d.ts`

- [ ] **Step 1: Write loader**

```ts
// lib/youtube-iframe.ts
'use client';

let loadPromise: Promise<typeof YT> | null = null;

export function loadYouTubeApi(): Promise<typeof YT> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });

  return loadPromise;
}
```

- [ ] **Step 2: Write minimal ambient types**

```ts
// types/youtube.d.ts
declare namespace YT {
  interface Player {
    loadVideoById(id: string, startSeconds?: number): void;
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead?: boolean): void;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    setPlaybackRate(rate: number): void;
    mute(): void;
    unMute(): void;
    destroy(): void;
  }
  interface PlayerEvent { target: Player }
  interface OnStateChangeEvent extends PlayerEvent { data: number }
  interface PlayerOptions {
    videoId?: string;
    width?: number | string;
    height?: number | string;
    playerVars?: Record<string, unknown>;
    events?: {
      onReady?: (e: PlayerEvent) => void;
      onStateChange?: (e: OnStateChangeEvent) => void;
      onError?: (e: { data: number }) => void;
    };
  }
  const PlayerState: {
    UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5;
  };
  class Player {
    constructor(el: HTMLElement | string, options: PlayerOptions);
  }
}

interface Window {
  YT: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/youtube-iframe.ts types/youtube.d.ts
git commit -m "Add YouTube IFrame API loader and types"
```

---

## Task 13: `useRoomSync` hook (SSE + drift correction)

**Files:**
- Create: `hooks/use-room-sync.ts`

- [ ] **Step 1: Write hook**

```ts
// hooks/use-room-sync.ts
'use client';

import { useEffect, useRef, useState } from 'react';
import type { RoomState, ServerEvent } from '@/types/room';
import { serverNow } from '@/lib/sync';

const HARD_CORRECTION_S = 0.5;
const SOFT_CORRECTION_S = 0.1;
const TICK_MS = 2000;
const SOFT_RATE_FAST = 1.05;
const SOFT_RATE_SLOW = 0.95;

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
  const softCorrectionUntil = useRef(0);

  stateRef.current = state;

  // SSE connection
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

  // Apply state changes (load / play / pause)
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

    const target = expectedPosition(state, serverNow(clockOffsetMs));
    if (state.isPlaying) {
      if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
        player.seekTo(target, true);
        player.playVideo();
      }
    } else {
      if (player.getPlayerState() !== YT.PlayerState.PAUSED) {
        player.pauseVideo();
        player.seekTo(target, true);
      }
    }
  }, [state, playerReady, audioUnlocked, clockOffsetMs, getPlayer]);

  // Drift-correction tick
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
        softCorrectionUntil.current = 0;
      } else if (abs > SOFT_CORRECTION_S) {
        player.setPlaybackRate(drift > 0 ? SOFT_RATE_FAST : SOFT_RATE_SLOW);
        softCorrectionUntil.current = Date.now() + 4000;
      } else if (Date.now() > softCorrectionUntil.current) {
        player.setPlaybackRate(1);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playerReady, audioUnlocked, clockOffsetMs, getPlayer]);

  return { state, listenerCount, driftMs };
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-room-sync.ts
git commit -m "Add useRoomSync hook with drift correction"
```

---

## Task 14: `Player` component

**Files:**
- Create: `components/player.tsx`

- [ ] **Step 1: Write component**

```tsx
// components/player.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi } from '@/lib/youtube-iframe';

export type PlayerHandle = {
  player: YT.Player | null;
};

type Props = {
  onReady: (player: YT.Player) => void;
};

export function Player({ onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const [mounted, setMounted] = useState(false);

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
        },
        events: {
          onReady: (e) => onReady(e.target),
        },
      });
    });

    return () => {
      destroyed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // onReady is intentionally not a dep — we only want to create the player once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/player.tsx
git commit -m "Add YouTube Player component"
```

---

## Task 15: `LoadInput` component

**Files:**
- Create: `components/load-input.tsx`

- [ ] **Step 1: Write component**

```tsx
// components/load-input.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseVideoId } from '@/lib/youtube';

export function LoadInput() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const videoId = parseVideoId(value);
    if (!videoId) {
      setError('Invalid YouTube URL or ID');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'load', videoId }),
      });
      if (!res.ok) {
        setError('Failed to load video');
      } else {
        setValue('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a YouTube URL or video ID"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <Button onClick={submit} disabled={loading || !value.trim()}>
          {loading ? 'Loading…' : 'Load'}
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/load-input.tsx
git commit -m "Add LoadInput component"
```

---

## Task 16: `TransportControls` component

**Files:**
- Create: `components/transport-controls.tsx`

- [ ] **Step 1: Write component**

```tsx
// components/transport-controls.tsx
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { RoomState } from '@/types/room';
import { serverNow } from '@/lib/sync';

type Props = {
  state: RoomState | null;
  clockOffsetMs: number | null;
  duration: number;
};

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function send(body: object) {
  await fetch('/api/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function TransportControls({ state, clockOffsetMs, duration }: Props) {
  const [displayPos, setDisplayPos] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  useEffect(() => {
    if (!state || clockOffsetMs === null) return;
    const tick = () => {
      const pos = state.isPlaying
        ? state.positionAtStart + (serverNow(clockOffsetMs) - state.startedAt) / 1000
        : state.positionAtStart;
      setDisplayPos(Math.max(0, pos));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state, clockOffsetMs]);

  const disabled = !state?.videoId;
  const current = scrubbing ?? displayPos;
  const max = duration > 0 ? duration : 1;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            if (!state) return;
            if (state.isPlaying) {
              send({ action: 'pause', position: displayPos });
            } else {
              send({ action: 'play' });
            }
          }}
        >
          {state?.isPlaying ? 'Pause' : 'Play'}
        </Button>
        <span className="font-mono text-sm tabular-nums text-neutral-400">
          {formatTime(current)} / {formatTime(duration)}
        </span>
      </div>
      <Slider
        min={0}
        max={max}
        step={0.1}
        value={[current]}
        disabled={disabled}
        onValueChange={(v) => setScrubbing(v[0])}
        onValueCommit={(v) => {
          setScrubbing(null);
          send({ action: 'seek', position: v[0] });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/transport-controls.tsx
git commit -m "Add TransportControls component"
```

---

## Task 17: `SyncIndicator` and `RoomHeader` components

**Files:**
- Create: `components/sync-indicator.tsx`
- Create: `components/room-header.tsx`

- [ ] **Step 1: Write `sync-indicator.tsx`**

```tsx
// components/sync-indicator.tsx
'use client';

type Props = { driftMs: number };

export function SyncIndicator({ driftMs }: Props) {
  const abs = Math.abs(driftMs);
  const color =
    abs < 100 ? 'text-emerald-400' : abs < 500 ? 'text-amber-400' : 'text-red-400';
  const symbol = abs < 100 ? '✓' : abs < 500 ? '~' : '!';
  return (
    <span className={`font-mono text-xs tabular-nums ${color}`}>
      drift {driftMs > 0 ? '+' : ''}{driftMs}ms {symbol}
    </span>
  );
}
```

- [ ] **Step 2: Write `room-header.tsx`**

```tsx
// components/room-header.tsx
'use client';

type Props = { listenerCount: number };

export function RoomHeader({ listenerCount }: Props) {
  return (
    <header className="flex w-full items-center justify-between">
      <h1 className="text-xl font-semibold tracking-tight">
        🔊 Collective Speaker
      </h1>
      <div className="text-sm text-neutral-400">
        👥 {listenerCount} listening
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/sync-indicator.tsx components/room-header.tsx
git commit -m "Add SyncIndicator and RoomHeader components"
```

---

## Task 18: `JoinOverlay` component

**Files:**
- Create: `components/join-overlay.tsx`

- [ ] **Step 1: Write component**

```tsx
// components/join-overlay.tsx
'use client';

import { Button } from '@/components/ui/button';

type Props = { onJoin: () => void };

export function JoinOverlay({ onJoin }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 rounded-xl border border-neutral-800 bg-neutral-950 p-10 text-center">
        <h2 className="text-2xl font-semibold">🔊 Collective Speaker</h2>
        <p className="max-w-sm text-neutral-400">
          Everyone here listens to the same YouTube audio, in perfect sync.
          Click below to join.
        </p>
        <Button size="lg" onClick={onJoin}>
          Click to join
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/join-overlay.tsx
git commit -m "Add JoinOverlay component"
```

---

## Task 19: Main page wiring

**Files:**
- Modify: `app/page.tsx` (replace contents entirely)
- Modify: `app/layout.tsx` (set title and dark theme)
- Modify: `app/globals.css` (ensure dark background)

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
// app/page.tsx
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

export default function HomePage() {
  const playerRef = useRef<YT.Player | null>(null);
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

  const { state, listenerCount, driftMs } = useRoomSync({
    clockOffsetMs,
    getPlayer,
    playerReady,
    audioUnlocked,
  });

  // Track duration when video changes
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
      // Triggering any player call inside this user gesture unlocks audio.
      player.playVideo();
      player.pauseVideo();
    }
    setAudioUnlocked(true);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <RoomHeader listenerCount={listenerCount} />

      <Player onReady={handlePlayerReady} />

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
        <SyncIndicator driftMs={driftMs} />
      </div>

      {!audioUnlocked && playerReady && <JoinOverlay onJoin={handleJoin} />}
    </main>
  );
}
```

- [ ] **Step 2: Update `app/layout.tsx`**

Open the existing `app/layout.tsx`. Change the `metadata` title/description to:
```ts
export const metadata: Metadata = {
  title: 'Collective Speaker',
  description: 'Listen to YouTube together, perfectly in sync.',
};
```

In the `<html>` tag, add `className="dark"`:
```tsx
<html lang="en" className="dark">
```

In the `<body>` tag, ensure it has classes including a dark background and text:
```tsx
<body className={`${geistSans.variable} ${geistMono.variable} bg-neutral-950 text-neutral-100 antialiased`}>
```

(Keep the existing font variable references that `create-next-app` generated.)

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/layout.tsx
git commit -m "Wire main page with player, controls, sync, and join overlay"
```

---

## Task 20: End-to-end manual verification

**Files:** none

- [ ] **Step 1: Start dev server**

Run: `pnpm dev` (background)

- [ ] **Step 2: Single-client smoke test**

Open http://localhost:3000 in a browser.
- Click "Click to join" — overlay disappears.
- Paste `https://www.youtube.com/watch?v=dQw4w9WgXcQ` and click Load.
- Audio should start playing.
- Click Pause / Play — both should work.
- Drag the seek slider — playback should jump.
- Drift indicator should show a small number in green.

- [ ] **Step 3: Two-client sync test**

Open the page in two browser windows (or one normal + one private). Join both.
- Load a video from window A. Window B should load the same video at the same position.
- Pause in B. A should pause within ~1 s.
- Seek to 60 s in A. B should jump there.
- Listener count in both should show `2`.

- [ ] **Step 4: Late-join test**

With a video already playing in window A, open a third browser/private tab.
- Click "Click to join". The video should load at roughly the current playback position of A (within ~1 s).
- Drift should converge to under 100 ms within 4–6 s.

- [ ] **Step 5: Kill dev server**

Stop the background dev process.

- [ ] **Step 6: Commit any small fixes discovered**

If verification surfaced bugs, fix and commit them with focused messages. If everything worked, no commit needed.

---

## Task 21: Deployment to Vercel (optional, on user request)

**Files:** none

- [ ] **Step 1: Ensure project is linked**

Ask the user: "Ready to deploy to Vercel? I'll run `vercel link` then `vercel --prod`. The Upstash env vars need to exist in the Vercel project — either added by you in the dashboard or via the Marketplace Upstash integration."

Wait for the user to confirm.

- [ ] **Step 2: Link and deploy**

Run:
```bash
vercel link
vercel --prod
```

- [ ] **Step 3: Smoke test the production URL**

Open the URL returned by `vercel --prod`. Repeat Task 20 Step 2 in production.

- [ ] **Step 4: Done**

No commit needed — deployment is a side effect.
