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
