import { NextResponse } from 'next/server';
import { runMetaSync } from '@/lib/syncMeta';
import { runGa4Sync } from '@/lib/syncGa4';

export const maxDuration = 60;

export async function POST() {
  try {
    // Se corren en paralelo e independientes: si GA4 no esta configurado
    // todavia (o falla), Meta se sigue sincronizando igual, y viceversa.
    const [metaResult, ga4Result] = await Promise.allSettled([runMetaSync(), runGa4Sync()]);

    if (metaResult.status === 'rejected') {
      return NextResponse.json({ error: metaResult.reason?.message || 'Error al sincronizar Meta' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      ...metaResult.value,
      ga4: ga4Result.status === 'fulfilled' ? ga4Result.value : { error: ga4Result.reason?.message },
      synced_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
