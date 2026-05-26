# Crowd Beat 🕺🔊

**https://crowd-beat-theta.vercel.app/**

You're at a party. No speaker. Everyone has a phone.

Open Crowd Beat, paste a YouTube link, and share the room URL. Everyone joins on their own device, hits play at the same time, and all the phones become one collective speaker. The music stays perfectly in sync across every device in the room.

Anyone can take control: swap the track, pause, skip. No app to install, no account to create. Just a link.

## How it works

Each client estimates its clock offset relative to the server via NTP-style round-trips, then uses that to compute where playback *should* be. A sync loop runs every 500ms: small drifts are corrected by adjusting playback rate, large drifts trigger a hard seek.

## Getting started

```bash
pnpm install
pnpm dev
```

Requires a Redis instance — set `REDIS_URL` in `.env.local`.
