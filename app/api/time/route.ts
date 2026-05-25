export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ now: Date.now() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
