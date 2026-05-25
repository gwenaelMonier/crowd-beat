import { redis } from '@/lib/redis';
import { getState } from '@/lib/room';
import {
  LISTENER_PREFIX,
  LISTENER_TTL_SECONDS,
  type ServerEvent,
} from '@/types/room';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEARTBEAT_MS = 10_000;
const CONNECTION_MAX_MS = 4 * 60 * 1000;
const STATE_POLL_MS = 1_000;

async function countListeners(): Promise<number> {
  let cursor: string | number = 0;
  let total = 0;
  while (true) {
    const result = (await redis.scan(cursor, {
      match: `${LISTENER_PREFIX}*`,
      count: 200,
    })) as [string | number, string[]];
    const nextCursor = result[0];
    total += result[1].length;
    if (nextCursor === 0 || nextCursor === '0') break;
    cursor = nextCursor;
  }
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
          if (!closed) {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          }
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
