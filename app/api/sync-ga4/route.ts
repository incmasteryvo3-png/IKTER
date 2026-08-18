import { NextRequest, NextResponse } from 'next/server';
import { runGa4Sync } from '@/lib/syncGa4';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const result = await runGa4Sync();
    return NextResponse.json({ ok: true, ...result, synced_at: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
