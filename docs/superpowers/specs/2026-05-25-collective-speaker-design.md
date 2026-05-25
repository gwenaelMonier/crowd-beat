# Collective Speaker — Design Spec

**Date:** 2026-05-25
**Status:** Approved (design phase)

## Goal

A website where every connected visitor listens to the same YouTube audio in tight (~50-100 ms) synchronization — a "collective speaker". One single global room. Anyone can paste a YouTube URL, play, pause, or seek; everyone follows in lockstep.

## Non-goals

- Multiple rooms (private or public)
- User accounts, chat, queues, voting
- Mobile app, native clients
- Persistence beyond current playback state (no history)
- Automated tests in v1

## Stack

- **Next.js 16 (App Router)** on **Vercel** (Fluid Compute)
- **Upstash Redis** via Vercel Marketplace (free tier) — shared state + pub/sub
- **YouTube IFrame Player API** — playback engine on the client
- **Server-Sent Events (SSE)** — server → client real-time push
- **POST API routes** — client → server commands
- **shadcn/ui + Tailwind** — UI components
- **TypeScript** everywhere

## Architecture

```
Client A  ── POST /api/control ──▶  Server  ── SET + PUBLISH ──▶  Upstash Redis
                                                                          │
                                                                          ▼
                                                              SUBSCRIBE (per SSE conn)
                                                                          │
                                Server (SSE) ◀────── pub/sub event ──────┘
                                      │
                                      ▼
                              All clients (A, B, C…)
                              apply event to YouTube player
```

**Shared state (Redis key `room:global`):**

```ts
type RoomState = {
  videoId: string | null;
  isPlaying: boolean;
  startedAt: number;        // server ms timestamp when current play started
  positionAtStart: number;  // video position (s) at startedAt
  updatedAt: number;
};
```

Current position (when playing) = `positionAtStart + (serverNow - startedAt) / 1000`.
When paused = `positionAtStart`.

## Synchronization (~50-100 ms target)

Three mechanisms running on every client:

### 1. Clock sync (NTP-lite)
On load and every 30 s:
- Make 5 calls to `GET /api/time`
- For each: measure `RTT = t1 - t0`, estimate `offset = tServer + RTT/2 - t1`
- Keep the offset from the call with the smallest RTT
- Store as `serverOffset`; `serverNow = Date.now() + serverOffset`

### 2. Expected-position calculation
At each tick (every 2 s):
```
expected = isPlaying
  ? positionAtStart + (serverNow - startedAt) / 1000
  : positionAtStart
drift = expected - player.getCurrentTime()
```

### 3. Drift correction
- `|drift| > 0.5 s` → `player.seekTo(expected)` (hard correction)
- `0.1 s < |drift| < 0.5 s` → set `playbackRate` to 1.05 or 0.95 for a few seconds (soft correction, imperceptible)
- `|drift| < 0.1 s` → no action

On any incoming SSE event, immediately recompute expected position and apply.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/time` | GET | `{ now: Date.now() }` for clock sync |
| `/api/state` | GET | Current `RoomState` snapshot |
| `/api/control` | POST | Body: `{ action: 'load' \| 'play' \| 'pause' \| 'seek', videoId?, position? }`. Writes Redis + publishes event |
| `/api/events` | GET (SSE) | Long-lived stream of `RoomState` updates + `listenerCount`. Capped at 4 min, client auto-reconnects |

## Listener count

Each SSE connection writes `SET listeners:<connId>` with TTL 15 s; heartbeats refresh it every 10 s. Count = `SCAN listeners:*`. Broadcast on change.

## File layout

```
app/
  page.tsx
  api/
    time/route.ts
    state/route.ts
    control/route.ts
    events/route.ts
lib/
  redis.ts
  room.ts        # getState, setState, publish
  sync.ts        # client clock-sync + drift logic
  youtube.ts     # URL → videoId parser/validator
components/
  player.tsx
  transport-controls.tsx
  load-input.tsx
  sync-indicator.tsx
  room-header.tsx
  join-overlay.tsx
hooks/
  use-room-sync.ts
  use-server-clock.ts
types/
  room.ts
```

## UI

Single dark-themed page:
- Header: title + live listener count
- YouTube player (controls hidden, replaced by custom)
- URL paste input + Load button
- Transport: play/pause, seek slider, time display
- Sync drift indicator (green < 100 ms, amber < 500 ms, red otherwise)
- First-visit overlay: "🔊 Click to join" — bypasses browser autoplay block

## Edge cases

| Case | Behavior |
|---|---|
| Browser blocks autoplay | Join overlay; one click unlocks audio |
| Mid-stream join | Fetch `/api/state`, seek to expected position, play |
| New video loaded | Server broadcasts `LOAD`; all clients `loadVideoById(id, 0)` |
| Network blip | SSE reconnects; client re-fetches `/api/state` and seeks |
| Concurrent play/pause | Last write wins in Redis; all clients converge |
| Invalid YouTube URL | Inline error in `LoadInput`; no broadcast |
| Unavailable video (region/age) | Show local error; shared state unchanged |
| SSE 4-min cap | Server closes; client auto-reconnects transparently |
| Empty state | Placeholder: "Paste a YouTube URL to start the party 🎵" |

## Out of scope for v1

- Tests (manual verification only)
- Analytics, logging beyond Vercel defaults
- Rate limiting (single global room, low abuse surface; can add later)
- Moderation tools
