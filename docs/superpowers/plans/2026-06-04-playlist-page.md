# Page `/playlist` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/playlist` page that plays every track of a YouTube playlist back-to-back, perfectly synchronized across all connected devices.

**Architecture:** A dedicated Redis room (`room:playlist`) holds a `PlaylistState` modeling the whole playlist as ONE continuous timeline (a global position in seconds). Each device deterministically computes which track + offset to play from the synchronized clock — no per-device "next" coordination. The existing SSE + clock-sync + drift-correction machinery is reused (extracting shared helpers where the single-video code can be generalized).

**Tech Stack:** Next.js 16 (App Router, client components), React 19, Upstash Redis, YouTube IFrame API + YouTube Data API v3, Vitest, Tailwind v4 + shadcn-style UI.

---

## Conventions (read before starting)

- Path alias `@/*` maps to repo root (see `tsconfig.json` and `vitest.config.ts`).
- Run a single test file: `npx vitest run <path>`. Run one test by name: `npx vitest run <path> -t "<name>"`.
- Tests use **explicit imports** (`import { describe, it, expect } from 'vitest'`) — `globals: false`.
- Typecheck/build the whole app: `npx next build` (slow) or quick typecheck: `npx tsc --noEmit`.
- Lint: `npm run lint`.
- Follow existing style: pure logic in `lib/*.ts` with sibling `*.test.ts`; React in `components/` and `hooks/`; thin route handlers in `app/api/**/route.ts` delegating to `lib/`.
- Commit after each task.

## File Structure

**New files**
- `lib/playlist-logic.ts` — pure timeline math + state transitions (`parseIso8601Duration`, `totalDuration`, `expectedPlaylistPosition`, `resolvePlaylistPosition`, `trackStartOffset`, `computeNextPlaylistState`).
- `lib/playlist-logic.test.ts`
- `lib/youtube-data.ts` — YouTube Data API client (`parsePlaylistId`, `fetchPlaylistTracks`).
- `lib/youtube-data.test.ts`
- `lib/playlist-room.ts` — Redis ops for the playlist room.
- `lib/room-stream.ts` — shared SSE stream factory (extracted from existing events route).
- `hooks/use-playlist-sync.ts` — playlist sync hook (timeline → player).
- `app/api/playlist/import/route.ts`
- `app/api/playlist/state/route.ts`
- `app/api/playlist/control/route.ts`
- `app/api/playlist/events/route.ts`
- `components/playlist-import.tsx`
- `components/playlist-controls.tsx`
- `components/playlist-tracklist.tsx`
- `app/playlist/page.tsx`

**Modified files**
- `types/room.ts` — playlist types + room key constants.
- `lib/sync-logic.ts` — extract reusable `decideDriftCorrection`.
- `app/api/events/route.ts` — delegate to `lib/room-stream.ts` (no behavior change).
- `.env.example` — add `YOUTUBE_API_KEY`.

---

### Task 1: Playlist types & room constants

**Files:**
- Modify: `types/room.ts`

- [ ] **Step 1: Add playlist types and constants**

Append to `types/room.ts` (after the existing exports):

```ts
export type PlaylistTrack = {
  videoId: string;
  title: string;
  durationS: number;
};

export type PlaylistState = {
  tracks: PlaylistTrack[];
  isPlaying: boolean;
  startedAt: number;
  positionAtStart: number;
  updatedAt: number;
};

export type PlaylistAction =
  | { action: 'loadPlaylist'; tracks: PlaylistTrack[] }
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'next' }
  | { action: 'prev' }
  | { action: 'seekToTrack'; index: number };

export type PlaylistServerEvent =
  | { type: 'state'; state: PlaylistState }
  | { type: 'listeners'; count: number };

export const PLAYLIST_ROOM_KEY = 'room:playlist';
export const PLAYLIST_ROOM_CHANNEL = 'room:playlist:events';
export const PLAYLIST_LISTENER_PREFIX = 'listeners:playlist:';
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add types/room.ts
git commit -m "feat(playlist): add playlist state types and room constants"
```

---

### Task 2: ISO-8601 duration parser

**Files:**
- Create: `lib/playlist-logic.ts`
- Test: `lib/playlist-logic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/playlist-logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseIso8601Duration } from './playlist-logic';

describe('parseIso8601Duration', () => {
  it('parses minutes and seconds', () => {
    expect(parseIso8601Duration('PT3M30S')).toBe(210);
  });
  it('parses hours, minutes, seconds', () => {
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
  });
  it('parses seconds only', () => {
    expect(parseIso8601Duration('PT45S')).toBe(45);
  });
  it('parses minutes only', () => {
    expect(parseIso8601Duration('PT10M')).toBe(600);
  });
  it('parses days', () => {
    expect(parseIso8601Duration('P1DT1H')).toBe(90000);
  });
  it('returns 0 for malformed input', () => {
    expect(parseIso8601Duration('garbage')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/playlist-logic.test.ts`
Expected: FAIL (`parseIso8601Duration` is not exported / module missing).

- [ ] **Step 3: Write minimal implementation**

Create `lib/playlist-logic.ts`:

```ts
export function parseIso8601Duration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(min ?? 0) * 60 +
    Number(s ?? 0)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/playlist-logic.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/playlist-logic.ts lib/playlist-logic.test.ts
git commit -m "feat(playlist): add ISO-8601 duration parser"
```

---

### Task 3: Timeline position resolution

**Files:**
- Modify: `lib/playlist-logic.ts`
- Test: `lib/playlist-logic.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/playlist-logic.test.ts`:

```ts
import {
  totalDuration,
  expectedPlaylistPosition,
  resolvePlaylistPosition,
  trackStartOffset,
} from './playlist-logic';
import type { PlaylistState } from '@/types/room';

const TRACKS = [
  { videoId: 'aaaaaaaaaaa', title: 'A', durationS: 100 },
  { videoId: 'bbbbbbbbbbb', title: 'B', durationS: 200 },
  { videoId: 'ccccccccccc', title: 'C', durationS: 50 },
];

// Playing from global position 0, started at t=1000ms.
const PLAYING: PlaylistState = {
  tracks: TRACKS,
  isPlaying: true,
  startedAt: 1000,
  positionAtStart: 0,
  updatedAt: 1000,
};

describe('totalDuration', () => {
  it('sums track durations', () => {
    expect(totalDuration(TRACKS)).toBe(350);
  });
});

describe('trackStartOffset', () => {
  it('returns cumulative seconds before a track', () => {
    expect(trackStartOffset(TRACKS, 0)).toBe(0);
    expect(trackStartOffset(TRACKS, 1)).toBe(100);
    expect(trackStartOffset(TRACKS, 2)).toBe(300);
  });
});

describe('expectedPlaylistPosition', () => {
  it('advances with elapsed wall-clock when playing', () => {
    // 30s elapsed since startedAt
    expect(expectedPlaylistPosition(PLAYING, 31_000)).toBeCloseTo(30);
  });
  it('is frozen at positionAtStart when paused', () => {
    const paused = { ...PLAYING, isPlaying: false, positionAtStart: 42 };
    expect(expectedPlaylistPosition(paused, 999_000)).toBe(42);
  });
});

describe('resolvePlaylistPosition', () => {
  it('resolves within the first track', () => {
    // 30s in → track 0, offset 30
    expect(resolvePlaylistPosition(PLAYING, 31_000)).toEqual({
      index: 0,
      offsetS: 30,
      ended: false,
    });
  });
  it('crosses into the second track', () => {
    // 150s in → track 1 (starts at 100), offset 50
    expect(resolvePlaylistPosition(PLAYING, 151_000)).toEqual({
      index: 1,
      offsetS: 50,
      ended: false,
    });
  });
  it('lands exactly on a track boundary at the start of the next track', () => {
    // 100s in → start of track 1
    expect(resolvePlaylistPosition(PLAYING, 101_000)).toEqual({
      index: 1,
      offsetS: 0,
      ended: false,
    });
  });
  it('reports ended past the total duration, parked on the last track', () => {
    // 400s in (> 350 total)
    expect(resolvePlaylistPosition(PLAYING, 401_000)).toEqual({
      index: 2,
      offsetS: 50,
      ended: true,
    });
  });
  it('reports ended for an empty playlist', () => {
    const empty = { ...PLAYING, tracks: [] };
    expect(resolvePlaylistPosition(empty, 5_000)).toEqual({
      index: 0,
      offsetS: 0,
      ended: true,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/playlist-logic.test.ts`
Expected: FAIL (new functions not exported).

- [ ] **Step 3: Write the implementation**

Append to `lib/playlist-logic.ts`:

```ts
import type { PlaylistState, PlaylistTrack } from '@/types/room';

export function totalDuration(tracks: PlaylistTrack[]): number {
  return tracks.reduce((sum, t) => sum + t.durationS, 0);
}

export function trackStartOffset(tracks: PlaylistTrack[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index; i++) acc += tracks[i].durationS;
  return acc;
}

export function expectedPlaylistPosition(
  state: PlaylistState,
  serverNowMs: number,
): number {
  if (!state.isPlaying) return state.positionAtStart;
  return state.positionAtStart + (serverNowMs - state.startedAt) / 1000;
}

export type ResolvedPosition = { index: number; offsetS: number; ended: boolean };

export function resolvePlaylistPosition(
  state: PlaylistState,
  serverNowMs: number,
): ResolvedPosition {
  const tracks = state.tracks;
  if (tracks.length === 0) return { index: 0, offsetS: 0, ended: true };

  let pos = expectedPlaylistPosition(state, serverNowMs);
  if (pos < 0) pos = 0;

  const total = totalDuration(tracks);
  const last = tracks.length - 1;
  if (pos >= total) {
    return { index: last, offsetS: tracks[last].durationS, ended: true };
  }

  let acc = 0;
  for (let i = 0; i < tracks.length; i++) {
    const d = tracks[i].durationS;
    if (pos < acc + d) return { index: i, offsetS: pos - acc, ended: false };
    acc += d;
  }
  return { index: last, offsetS: tracks[last].durationS, ended: true };
}
```

> Note: the `import type` line goes at the **top** of the file (move it above `parseIso8601Duration` so all imports sit together).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/playlist-logic.test.ts`
Expected: PASS (all tests, including Task 2's 6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/playlist-logic.ts lib/playlist-logic.test.ts
git commit -m "feat(playlist): add continuous-timeline position resolution"
```

---

### Task 4: Playlist state transitions (`computeNextPlaylistState`)

**Files:**
- Modify: `lib/playlist-logic.ts`
- Test: `lib/playlist-logic.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/playlist-logic.test.ts`:

```ts
import { computeNextPlaylistState } from './playlist-logic';
import type { PlaylistAction } from '@/types/room';

const NOW = 10_000;

describe('computeNextPlaylistState', () => {
  it('loads a playlist starting at position 0 and playing', () => {
    const empty: PlaylistState = {
      tracks: [], isPlaying: false, startedAt: 0, positionAtStart: 0, updatedAt: 0,
    };
    const action: PlaylistAction = { action: 'loadPlaylist', tracks: TRACKS };
    const result = computeNextPlaylistState(empty, action, NOW);
    expect(result).toEqual({
      kind: 'ok',
      next: { tracks: TRACKS, isPlaying: true, startedAt: NOW, positionAtStart: 0, updatedAt: NOW },
    });
  });

  it('rejects an empty playlist load', () => {
    const empty: PlaylistState = {
      tracks: [], isPlaying: false, startedAt: 0, positionAtStart: 0, updatedAt: 0,
    };
    const result = computeNextPlaylistState(empty, { action: 'loadPlaylist', tracks: [] }, NOW);
    expect(result.kind).toBe('error');
  });

  it('pause freezes the current global position', () => {
    // PLAYING started at 1000, now 31000 → 30s in
    const result = computeNextPlaylistState(PLAYING, { action: 'pause' }, 31_000);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.isPlaying).toBe(false);
    expect(result.next.positionAtStart).toBeCloseTo(30);
  });

  it('play resumes from the frozen position', () => {
    const paused: PlaylistState = {
      tracks: TRACKS, isPlaying: false, startedAt: 5_000, positionAtStart: 42, updatedAt: 5_000,
    };
    const result = computeNextPlaylistState(paused, { action: 'play' }, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next).toEqual({
      tracks: TRACKS, isPlaying: true, startedAt: NOW, positionAtStart: 42, updatedAt: NOW,
    });
  });

  it('seekToTrack jumps to the track start offset', () => {
    const result = computeNextPlaylistState(PLAYING, { action: 'seekToTrack', index: 2 }, NOW);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.positionAtStart).toBe(300); // start of track 2
    expect(result.next.isPlaying).toBe(true);
  });

  it('seekToTrack rejects an out-of-range index', () => {
    const result = computeNextPlaylistState(PLAYING, { action: 'seekToTrack', index: 9 }, NOW);
    expect(result.kind).toBe('error');
  });

  it('next advances to the following track', () => {
    // 30s in → currently track 0 → next = track 1 (offset 100)
    const result = computeNextPlaylistState(PLAYING, { action: 'next' }, 31_000);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.positionAtStart).toBe(100);
    expect(result.next.isPlaying).toBe(true);
  });

  it('next on the last track stops at the end', () => {
    // 320s in → track 2 (last) → next stops, position = total
    const result = computeNextPlaylistState(PLAYING, { action: 'next' }, 321_000);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.isPlaying).toBe(false);
    expect(result.next.positionAtStart).toBe(350);
  });

  it('prev goes to the previous track, floored at 0', () => {
    // 150s in → track 1 → prev = track 0 (offset 0)
    const result = computeNextPlaylistState(PLAYING, { action: 'prev' }, 151_000);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.next.positionAtStart).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/playlist-logic.test.ts`
Expected: FAIL (`computeNextPlaylistState` not exported).

- [ ] **Step 3: Write the implementation**

Append to `lib/playlist-logic.ts`:

```ts
import type { PlaylistAction } from '@/types/room';

export type PlaylistControlResult =
  | { kind: 'ok'; next: PlaylistState }
  | { kind: 'error'; status: number; message: string };

export function computeNextPlaylistState(
  current: PlaylistState,
  action: PlaylistAction,
  now: number,
): PlaylistControlResult {
  switch (action.action) {
    case 'loadPlaylist': {
      if (action.tracks.length === 0) {
        return { kind: 'error', status: 400, message: 'Empty playlist' };
      }
      return {
        kind: 'ok',
        next: {
          tracks: action.tracks,
          isPlaying: true,
          startedAt: now,
          positionAtStart: 0,
          updatedAt: now,
        },
      };
    }
    case 'play': {
      if (current.tracks.length === 0) {
        return { kind: 'error', status: 400, message: 'No playlist loaded' };
      }
      if (current.isPlaying) return { kind: 'ok', next: current };
      return {
        kind: 'ok',
        next: { ...current, isPlaying: true, startedAt: now, updatedAt: now },
      };
    }
    case 'pause': {
      return {
        kind: 'ok',
        next: {
          ...current,
          isPlaying: false,
          positionAtStart: expectedPlaylistPosition(current, now),
          startedAt: now,
          updatedAt: now,
        },
      };
    }
    case 'seekToTrack': {
      if (action.index < 0 || action.index >= current.tracks.length) {
        return { kind: 'error', status: 400, message: 'Track index out of range' };
      }
      return {
        kind: 'ok',
        next: {
          ...current,
          positionAtStart: trackStartOffset(current.tracks, action.index),
          startedAt: now,
          isPlaying: true,
          updatedAt: now,
        },
      };
    }
    case 'next': {
      const { index } = resolvePlaylistPosition(current, now);
      const target = index + 1;
      if (target >= current.tracks.length) {
        return {
          kind: 'ok',
          next: {
            ...current,
            isPlaying: false,
            positionAtStart: totalDuration(current.tracks),
            startedAt: now,
            updatedAt: now,
          },
        };
      }
      return {
        kind: 'ok',
        next: {
          ...current,
          positionAtStart: trackStartOffset(current.tracks, target),
          startedAt: now,
          isPlaying: true,
          updatedAt: now,
        },
      };
    }
    case 'prev': {
      const { index } = resolvePlaylistPosition(current, now);
      const target = Math.max(0, index - 1);
      return {
        kind: 'ok',
        next: {
          ...current,
          positionAtStart: trackStartOffset(current.tracks, target),
          startedAt: now,
          isPlaying: true,
          updatedAt: now,
        },
      };
    }
  }
}
```

> Move the `import type { PlaylistAction }` to the top import block with the others.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/playlist-logic.test.ts`
Expected: PASS (all playlist-logic tests).

- [ ] **Step 5: Commit**

```bash
git add lib/playlist-logic.ts lib/playlist-logic.test.ts
git commit -m "feat(playlist): add playlist state transitions"
```

---

### Task 5: Parse a YouTube playlist ID

**Files:**
- Create: `lib/youtube-data.ts`
- Test: `lib/youtube-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/youtube-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePlaylistId } from './youtube-data';

describe('parsePlaylistId', () => {
  it('extracts list param from a watch URL', () => {
    expect(parsePlaylistId('https://www.youtube.com/watch?v=abc&list=PL123_abc')).toBe('PL123_abc');
  });
  it('extracts list param from a playlist URL', () => {
    expect(parsePlaylistId('https://www.youtube.com/playlist?list=PLxyz-789')).toBe('PLxyz-789');
  });
  it('accepts a raw playlist id', () => {
    expect(parsePlaylistId('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf')).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
  });
  it('returns null for a URL with no list', () => {
    expect(parsePlaylistId('https://www.youtube.com/watch?v=abc')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(parsePlaylistId('   ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/youtube-data.test.ts`
Expected: FAIL (module/function missing).

- [ ] **Step 3: Write minimal implementation**

Create `lib/youtube-data.ts`:

```ts
const PLAYLIST_ID_REGEX = /^[A-Za-z0-9_-]+$/;

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get('list');
    if (list && PLAYLIST_ID_REGEX.test(list)) return list;
    return null;
  } catch {
    // not a URL — fall through to raw-id check
  }
  return PLAYLIST_ID_REGEX.test(trimmed) ? trimmed : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/youtube-data.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-data.ts lib/youtube-data.test.ts
git commit -m "feat(playlist): add YouTube playlist id parser"
```

---

### Task 6: Fetch playlist tracks from YouTube Data API

**Files:**
- Modify: `lib/youtube-data.ts`
- Test: `lib/youtube-data.test.ts`

- [ ] **Step 1: Write the failing test (with a stubbed fetch)**

Append to `lib/youtube-data.test.ts`:

```ts
import { fetchPlaylistTracks } from './youtube-data';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('fetchPlaylistTracks', () => {
  it('paginates items then resolves durations, preserving order', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith('/playlistItems')) {
        if (!url.searchParams.get('pageToken')) {
          return jsonResponse({
            nextPageToken: 'PAGE2',
            items: [
              { contentDetails: { videoId: 'vid0000000a' }, snippet: { title: 'Song A' } },
            ],
          });
        }
        return jsonResponse({
          items: [
            { contentDetails: { videoId: 'vid0000000b' }, snippet: { title: 'Song B' } },
          ],
        });
      }
      // /videos
      return jsonResponse({
        items: [
          { id: 'vid0000000a', contentDetails: { duration: 'PT3M' } },
          { id: 'vid0000000b', contentDetails: { duration: 'PT1M30S' } },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await fetchPlaylistTracks('PL123', 'KEY');
    expect(tracks).toEqual([
      { videoId: 'vid0000000a', title: 'Song A', durationS: 180 },
      { videoId: 'vid0000000b', title: 'Song B', durationS: 90 },
    ]);
  });

  it('skips items with no resolvable duration (deleted/private)', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith('/playlistItems')) {
        return jsonResponse({
          items: [
            { contentDetails: { videoId: 'gooooooooood' }, snippet: { title: 'Good' } },
            { contentDetails: { videoId: 'deleteddddd1' }, snippet: { title: 'Gone' } },
          ],
        });
      }
      return jsonResponse({ items: [{ id: 'gooooooooood', contentDetails: { duration: 'PT10S' } }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await fetchPlaylistTracks('PL123', 'KEY');
    expect(tracks).toEqual([{ videoId: 'gooooooooood', title: 'Good', durationS: 10 }]);
  });

  it('throws when the API responds with an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 }) as Response));
    await expect(fetchPlaylistTracks('PL123', 'KEY')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/youtube-data.test.ts`
Expected: FAIL (`fetchPlaylistTracks` not exported).

- [ ] **Step 3: Write the implementation**

Append to `lib/youtube-data.ts`:

```ts
import type { PlaylistTrack } from '@/types/room';
import { parseIso8601Duration } from '@/lib/playlist-logic';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

type PlaylistItemsResponse = {
  nextPageToken?: string;
  items: { contentDetails: { videoId: string }; snippet: { title: string } }[];
};

type VideosResponse = {
  items: { id: string; contentDetails: { duration: string } }[];
};

export async function fetchPlaylistTracks(
  playlistId: string,
  apiKey: string,
): Promise<PlaylistTrack[]> {
  // 1. Collect video ids + titles, following pagination.
  const items: { videoId: string; title: string }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${API_BASE}/playlistItems`);
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`YouTube playlistItems failed: ${res.status}`);
    const data = (await res.json()) as PlaylistItemsResponse;
    for (const it of data.items) {
      items.push({ videoId: it.contentDetails.videoId, title: it.snippet.title });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // 2. Resolve durations in batches of 50.
  const durations = new Map<string, number>();
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const url = new URL(`${API_BASE}/videos`);
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('id', batch.map((b) => b.videoId).join(','));
    url.searchParams.set('key', apiKey);

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`YouTube videos failed: ${res.status}`);
    const data = (await res.json()) as VideosResponse;
    for (const v of data.items) {
      durations.set(v.id, parseIso8601Duration(v.contentDetails.duration));
    }
  }

  // 3. Build tracks in playlist order, dropping unavailable videos.
  return items
    .filter((it) => durations.has(it.videoId))
    .map((it) => ({
      videoId: it.videoId,
      title: it.title,
      durationS: durations.get(it.videoId)!,
    }));
}
```

> Move the two `import` lines to the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/youtube-data.test.ts`
Expected: PASS (all youtube-data tests).

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-data.ts lib/youtube-data.test.ts
git commit -m "feat(playlist): fetch playlist tracks via YouTube Data API"
```

---

### Task 7: Playlist Redis room operations

**Files:**
- Create: `lib/playlist-room.ts`

- [ ] **Step 1: Write the implementation**

Create `lib/playlist-room.ts`:

```ts
import { redis } from './redis';
import {
  PLAYLIST_ROOM_CHANNEL,
  PLAYLIST_ROOM_KEY,
  type PlaylistServerEvent,
  type PlaylistState,
} from '@/types/room';

export const INITIAL_PLAYLIST_STATE: PlaylistState = {
  tracks: [],
  isPlaying: false,
  startedAt: 0,
  positionAtStart: 0,
  updatedAt: 0,
};

export async function getPlaylistState(): Promise<PlaylistState> {
  const stored = await redis.get<PlaylistState>(PLAYLIST_ROOM_KEY);
  return stored ?? INITIAL_PLAYLIST_STATE;
}

export async function setPlaylistState(state: PlaylistState): Promise<void> {
  await redis.set(PLAYLIST_ROOM_KEY, state);
}

export async function publishPlaylist(event: PlaylistServerEvent): Promise<void> {
  await redis.publish(PLAYLIST_ROOM_CHANNEL, JSON.stringify(event));
}

export async function setPlaylistStateAndPublish(state: PlaylistState): Promise<void> {
  await setPlaylistState(state);
  await publishPlaylist({ type: 'state', state });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/playlist-room.ts
git commit -m "feat(playlist): add playlist room redis operations"
```

---

### Task 8: Extract reusable drift correction

**Files:**
- Modify: `lib/sync-logic.ts`
- Test: `lib/sync-logic.test.ts`

This refactor pulls the per-track drift decision out of `decideOnTick` so the playlist hook can reuse it. Existing behavior must not change.

- [ ] **Step 1: Write the failing test for the extracted helper**

Append to `lib/sync-logic.test.ts`:

```ts
import { decideDriftCorrection } from './sync-logic';

describe('decideDriftCorrection', () => {
  it('hard-seeks when drift exceeds the hard threshold', () => {
    // expected 10s, player at 9s → drift +1s
    expect(decideDriftCorrection(10, 9)).toEqual({ kind: 'seek', to: 10 });
  });
  it('speeds up when slightly behind', () => {
    const d = decideDriftCorrection(10, 9.95); // drift +0.05s
    expect(d.kind).toBe('setRate');
    if (d.kind === 'setRate') expect(d.rate).toBeGreaterThan(1);
  });
  it('slows down when slightly ahead', () => {
    const d = decideDriftCorrection(10, 10.05); // drift -0.05s
    expect(d.kind).toBe('setRate');
    if (d.kind === 'setRate') expect(d.rate).toBeLessThan(1);
  });
  it('returns to normal rate when in sync', () => {
    expect(decideDriftCorrection(10, 10)).toEqual({ kind: 'setRate', rate: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sync-logic.test.ts`
Expected: FAIL (`decideDriftCorrection` not exported).

- [ ] **Step 3: Extract the helper and rewire `decideOnTick`**

In `lib/sync-logic.ts`, add the exported helper:

```ts
export function decideDriftCorrection(
  expectedS: number,
  playerTimeS: number,
): SyncDecision {
  const drift = expectedS - playerTimeS;
  const abs = Math.abs(drift);

  if (abs > HARD_CORRECTION_S) return { kind: 'seek', to: expectedS };
  if (abs > SOFT_CORRECTION_S) {
    const delta = Math.min(MAX_RATE_DELTA, abs * RATE_GAIN);
    return { kind: 'setRate', rate: drift > 0 ? 1 + delta : 1 - delta };
  }
  return { kind: 'setRate', rate: 1 };
}
```

Then replace the tail of `decideOnTick` (the block from `const expected = expectedPosition(...)` to the final `return { kind: 'setRate', rate: 1 };`) with:

```ts
  return decideDriftCorrection(expectedPosition(state, serverNowMs), playerTimeS);
```

- [ ] **Step 4: Run the full sync-logic suite to verify nothing regressed**

Run: `npx vitest run lib/sync-logic.test.ts`
Expected: PASS (existing tests + 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/sync-logic.ts lib/sync-logic.test.ts
git commit -m "refactor(sync): extract reusable decideDriftCorrection"
```

---

### Task 9: Extract a shared SSE room-stream factory

**Files:**
- Create: `lib/room-stream.ts`
- Modify: `app/api/events/route.ts`

Generalize the existing events route so both the global room and the playlist room reuse one SSE implementation. Behavior for `/api/events` must be unchanged.

- [ ] **Step 1: Create the shared factory**

Create `lib/room-stream.ts`:

```ts
import { redis } from '@/lib/redis';
import { LISTENER_TTL_SECONDS } from '@/types/room';

const HEARTBEAT_MS = 10_000;
const CONNECTION_MAX_MS = 4 * 60 * 1000;
const STATE_POLL_MS = 1_000;

type RoomStreamOptions = {
  listenerPrefix: string;
  getState: () => Promise<unknown>;
};

async function countListeners(prefix: string): Promise<number> {
  let cursor: string | number = 0;
  let total = 0;
  while (true) {
    const result = (await redis.scan(cursor, {
      match: `${prefix}*`,
      count: 200,
    })) as [string | number, string[]];
    const nextCursor = result[0];
    total += result[1].length;
    if (nextCursor === 0 || nextCursor === '0') break;
    cursor = nextCursor;
  }
  return total;
}

export function createRoomStream({ listenerPrefix, getState }: RoomStreamOptions): Response {
  const connId = crypto.randomUUID();
  const listenerKey = `${listenerPrefix}${connId}`;
  const encoder = new TextEncoder();
  let closed = false;
  let lastStateJson = '';
  let lastListenerCount = -1;

  const stream = new ReadableStream({
    async start(controller) {
      await redis.set(listenerKey, '1', { ex: LISTENER_TTL_SECONDS });

      const send = (event: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const initialState = await getState();
      lastStateJson = JSON.stringify(initialState);
      send({ type: 'state', state: initialState });

      const initialCount = await countListeners(listenerPrefix);
      lastListenerCount = initialCount;
      send({ type: 'listeners', count: initialCount });

      const heartbeat = setInterval(async () => {
        try {
          await redis.set(listenerKey, '1', { ex: LISTENER_TTL_SECONDS });
          const count = await countListeners(listenerPrefix);
          if (count !== lastListenerCount) {
            lastListenerCount = count;
            send({ type: 'listeners', count });
          }
          if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // ignore transient errors
        }
      }, HEARTBEAT_MS);

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

- [ ] **Step 2: Rewrite `app/api/events/route.ts` to delegate**

Replace the entire contents of `app/api/events/route.ts` with:

```ts
import { getState } from '@/lib/room';
import { LISTENER_PREFIX } from '@/types/room';
import { createRoomStream } from '@/lib/room-stream';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  return createRoomStream({ listenerPrefix: LISTENER_PREFIX, getState });
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual smoke check of the global room (regression guard)**

Run: `npm run dev`, open `http://localhost:3000`, paste a YouTube URL, confirm the video loads/plays and the listener count appears (open a second tab → count becomes 2). Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add lib/room-stream.ts app/api/events/route.ts
git commit -m "refactor(events): extract shared room SSE stream factory"
```

---

### Task 10: Playlist SSE events route

**Files:**
- Create: `app/api/playlist/events/route.ts`

- [ ] **Step 1: Write the implementation**

Create `app/api/playlist/events/route.ts`:

```ts
import { getPlaylistState } from '@/lib/playlist-room';
import { PLAYLIST_LISTENER_PREFIX } from '@/types/room';
import { createRoomStream } from '@/lib/room-stream';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  return createRoomStream({
    listenerPrefix: PLAYLIST_LISTENER_PREFIX,
    getState: getPlaylistState,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/playlist/events/route.ts
git commit -m "feat(playlist): add playlist SSE events route"
```

---

### Task 11: Playlist state route

**Files:**
- Create: `app/api/playlist/state/route.ts`

- [ ] **Step 1: Write the implementation**

Create `app/api/playlist/state/route.ts`:

```ts
import { getPlaylistState } from '@/lib/playlist-room';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getPlaylistState();
  return Response.json(state, { headers: { 'Cache-Control': 'no-store' } });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/playlist/state/route.ts
git commit -m "feat(playlist): add playlist state route"
```

---

### Task 12: Playlist control route

**Files:**
- Create: `app/api/playlist/control/route.ts`

- [ ] **Step 1: Write the implementation**

Create `app/api/playlist/control/route.ts`:

```ts
import { getPlaylistState, setPlaylistStateAndPublish } from '@/lib/playlist-room';
import { computeNextPlaylistState } from '@/lib/playlist-logic';
import type { PlaylistAction } from '@/types/room';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as PlaylistAction;
  const current = await getPlaylistState();
  const result = computeNextPlaylistState(current, body, Date.now());

  if (result.kind === 'error') {
    return Response.json({ error: result.message }, { status: result.status });
  }

  await setPlaylistStateAndPublish(result.next);
  return Response.json(result.next);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/playlist/control/route.ts
git commit -m "feat(playlist): add playlist control route"
```

---

### Task 13: Playlist import route

**Files:**
- Create: `app/api/playlist/import/route.ts`

- [ ] **Step 1: Write the implementation**

Create `app/api/playlist/import/route.ts`:

```ts
import { parsePlaylistId, fetchPlaylistTracks } from '@/lib/youtube-data';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { url } = (await req.json()) as { url?: string };
  const playlistId = parsePlaylistId(url ?? '');
  if (!playlistId) {
    return Response.json({ error: 'Invalid playlist URL' }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'Server missing YOUTUBE_API_KEY' }, { status: 500 });
  }

  try {
    const tracks = await fetchPlaylistTracks(playlistId, apiKey);
    if (tracks.length === 0) {
      return Response.json({ error: 'Playlist empty or unavailable' }, { status: 404 });
    }
    return Response.json({ tracks });
  } catch {
    return Response.json({ error: 'Failed to fetch playlist' }, { status: 502 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/playlist/import/route.ts
git commit -m "feat(playlist): add YouTube playlist import route"
```

---

### Task 14: Playlist sync hook

**Files:**
- Create: `hooks/use-playlist-sync.ts`

This hook mirrors `use-room-sync.ts` but drives the player from the continuous timeline. A single 500ms tick handles initial load, **automatic track advance** (the resolved index changes purely from clock progression — no state event fires), drift correction, and pause/stop. It reuses the adaptive pre-buffer trick from `use-room-sync.ts`.

- [ ] **Step 1: Write the implementation**

Create `hooks/use-playlist-sync.ts`:

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlaylistState, PlaylistServerEvent } from '@/types/room';
import { serverNow } from '@/lib/sync';
import { resolvePlaylistPosition } from '@/lib/playlist-logic';
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
};

export function usePlaylistSync(params: UsePlaylistSyncParams): UsePlaylistSyncResult {
  const { clockOffsetMs, getPlayer, playerReady, audioUnlocked } = params;
  const [state, setState] = useState<PlaylistState | null>(null);
  const [listenerCount, setListenerCount] = useState(0);
  const [driftMs, setDriftMs] = useState(0);
  const [resolved, setResolved] = useState({ index: 0, offsetS: 0, ended: false });
  const stateRef = useRef<PlaylistState | null>(null);
  const currentVideoRef = useRef<string | null>(null);

  stateRef.current = state;

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
      const track = s.tracks[pos.index];
      if (!track) return;

      // New track (auto-advance, seek, or first load): load it at the right offset.
      if (track.videoId !== currentVideoRef.current) {
        setDriftMs(0);
        pendingSeekTarget = null;
        seekIssuedAt = null;
        player.loadVideoById(track.videoId, Math.max(0, pos.offsetS));
        currentVideoRef.current = track.videoId;
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
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-playlist-sync.ts
git commit -m "feat(playlist): add playlist timeline sync hook"
```

---

### Task 15: Playlist UI components

**Files:**
- Create: `components/playlist-import.tsx`
- Create: `components/playlist-controls.tsx`
- Create: `components/playlist-tracklist.tsx`

- [ ] **Step 1: Create the import component**

Create `components/playlist-import.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PlaylistTrack } from '@/types/room';

export function PlaylistImport() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/playlist/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const data = (await res.json()) as { tracks?: PlaylistTrack[]; error?: string };
      if (!res.ok || !data.tracks) {
        setError(data.error ?? 'Failed to import playlist');
        return;
      }
      const loadRes = await fetch('/api/playlist/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'loadPlaylist', tracks: data.tracks }),
      });
      if (!loadRes.ok) {
        setError('Failed to start playlist');
        return;
      }
      setValue('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          className="flex-1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a YouTube playlist URL"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <Button className="shrink-0" onClick={submit} disabled={loading || !value.trim()}>
          {loading ? 'Importing…' : 'Load playlist'}
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create the transport controls component**

Create `components/playlist-controls.tsx`:

```tsx
'use client';

import { SkipBack, SkipForward, Play, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlaylistAction } from '@/types/room';

type Props = { isPlaying: boolean; hasPlaylist: boolean };

async function send(action: PlaylistAction) {
  await fetch('/api/playlist/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action),
  });
}

export function PlaylistControls({ isPlaying, hasPlaylist }: Props) {
  return (
    <div className="flex items-center justify-center gap-2">
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
```

> If `lucide-react` icon names differ in this version, fall back to text labels (`◀◀`, `▶/⏸`, `▶▶`). Verify by checking `node_modules/lucide-react` exports during Step 4.

- [ ] **Step 3: Create the tracklist component**

Create `components/playlist-tracklist.tsx`:

```tsx
'use client';

import type { PlaylistTrack } from '@/types/room';

type Props = {
  tracks: PlaylistTrack[];
  currentIndex: number;
  offsetS: number;
};

function fmt(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function PlaylistTracklist({ tracks, currentIndex, offsetS }: Props) {
  async function jumpTo(index: number) {
    await fetch('/api/playlist/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'seekToTrack', index }),
    });
  }

  return (
    <ul className="flex flex-col divide-y divide-neutral-800 overflow-hidden rounded-lg border border-neutral-800">
      {tracks.map((track, i) => {
        const isCurrent = i === currentIndex;
        const progress = isCurrent ? Math.min(100, (offsetS / track.durationS) * 100) : 0;
        return (
          <li key={`${track.videoId}-${i}`} className="relative">
            {isCurrent && (
              <div
                className="absolute inset-y-0 left-0 bg-neutral-800/60"
                style={{ width: `${progress}%` }}
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={() => jumpTo(i)}
              className={`relative flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-900 ${
                isCurrent ? 'font-medium text-white' : 'text-neutral-400'
              }`}
            >
              <span className="w-6 shrink-0 tabular-nums text-neutral-500">{i + 1}</span>
              <span className="flex-1 truncate">{track.title}</span>
              <span className="shrink-0 tabular-nums text-neutral-500">{fmt(track.durationS)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (If `lucide-react` icon imports error, switch to the text-label fallback noted in Step 2.)

- [ ] **Step 5: Commit**

```bash
git add components/playlist-import.tsx components/playlist-controls.tsx components/playlist-tracklist.tsx
git commit -m "feat(playlist): add playlist UI components"
```

---

### Task 16: The `/playlist` page

**Files:**
- Create: `app/playlist/page.tsx`

- [ ] **Step 1: Write the page**

Create `app/playlist/page.tsx`:

```tsx
'use client';

import { useCallback, useRef, useState } from 'react';
import { Player } from '@/components/player';
import { JoinOverlay } from '@/components/join-overlay';
import { RoomHeader } from '@/components/room-header';
import { SyncIndicator } from '@/components/sync-indicator';
import { PlaylistImport } from '@/components/playlist-import';
import { PlaylistControls } from '@/components/playlist-controls';
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
```

> Check `components/room-header.tsx` and `components/sync-indicator.tsx` prop signatures before relying on them (they are reused from the home page with `listenerCount`, `driftMs`, and `rttMs`). Adjust prop names if they differ.

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/playlist/page.tsx
git commit -m "feat(playlist): add /playlist page"
```

---

### Task 17: Env var, full build, and end-to-end verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Document the new env var**

Append to `.env.example`:

```
YOUTUBE_API_KEY=
```

- [ ] **Step 2: Set the key locally**

Add `YOUTUBE_API_KEY=<your key>` to `.env.local` (create a YouTube Data API v3 key in Google Cloud Console if needed). Do NOT commit `.env.local`.

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: PASS — `/playlist` and `/api/playlist/*` appear in the route list.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all suites, old and new).

- [ ] **Step 5: Manual end-to-end check**

Run `npm run dev`. In browser:
1. Open `http://localhost:3000/playlist`, click "Click to join".
2. Paste a real YouTube playlist URL, click "Load playlist" → tracks appear, first track starts playing.
3. Confirm the current track is highlighted with a moving progress bar.
4. Click a different track → all playback jumps there.
5. Click Next / Previous / Pause / Play → behave correctly.
6. Open `http://localhost:3000/playlist` in a second tab, join → both tabs play the same track in sync (drift indicator near 0). Listener count shows 2.
7. Let a short track end → it auto-advances to the next track on both tabs.
8. Confirm the home page `/` still works independently (its own video, separate room).

- [ ] **Step 6: Commit**

```bash
git add .env.example
git commit -m "feat(playlist): document YOUTUBE_API_KEY env var"
```

---

## Self-Review Notes (spec coverage)

- Timeline-by-durations model → Tasks 2–4 (`playlist-logic`).
- Dedicated `room:playlist` (no regression on `/`) → Tasks 1, 7, 9–12; refactor verified in Task 9 Step 4.
- YouTube Data API import + ISO-8601 durations → Tasks 2, 5, 6, 13.
- Controls: play/pause, next/prev, click-to-jump, current-track + progress indicator → Tasks 15, 16.
- End-of-playlist = stop on last track → Task 4 (`next` at end, `resolvePlaylistPosition` `ended`).
- Error handling (invalid URL, missing key, empty/unavailable playlist) → Task 13.
- Reuse of sync machinery via extracted helpers → Tasks 8 (`decideDriftCorrection`), 9 (`createRoomStream`), 14 (hook).
- Tests: pure logic fully TDD'd (Tasks 2–6, 8); routes/UI verified by typecheck + build + manual E2E (Task 17).
