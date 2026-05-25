import { getState, setStateAndPublish } from '@/lib/room';
import { computeNextState } from '@/lib/control-logic';
import type { ControlAction } from '@/types/room';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as ControlAction;
  const current = await getState();
  const result = computeNextState(current, body, Date.now());

  if (result.kind === 'error') {
    return Response.json({ error: result.message }, { status: result.status });
  }

  await setStateAndPublish(result.next);
  return Response.json(result.next);
}
