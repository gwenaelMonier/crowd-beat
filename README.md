# Collective Speaker

**https://crowd-beat-theta.vercel.app/**

Collective Speaker lets multiple people listen to the same YouTube video in perfect sync — paste a URL, hit play, and everyone connected hears it at the same time.
Anyone in the room can control playback: load a new video, play, pause, or seek, and all listeners follow instantly.
No account needed — just open the page, click to join, and you're part of the collective.

## How it works

Each client estimates its clock offset relative to the server via NTP-style round-trips, then uses that to compute where playback *should* be. A sync loop runs every 500ms: small drifts are corrected by adjusting playback rate, large drifts trigger a hard seek.

## Getting started

```bash
pnpm install
pnpm dev
```

Requires a Redis instance — set `REDIS_URL` in `.env.local`.
