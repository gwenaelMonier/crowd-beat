import { getState } from '@/lib/room';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getState();
  return Response.json(state, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
