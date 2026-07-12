import { NextRequest, NextResponse } from 'next/server';
import { runMetaSync } from '@/lib/syncMeta';

export const maxDuration = 60;

// Ruta usada por el cron de Vercel (ver vercel.json).
// Vercel agrega automaticamente "Authorization: Bearer <CRON_SECRET>"
// en las llamadas programadas cuando defines la variable de entorno CRON_SECRET.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const result = await runMetaSync();
    return NextResponse.json({ ok: true, ...result, synced_at: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
