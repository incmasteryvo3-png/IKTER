import { NextRequest, NextResponse } from 'next/server';
import { fetchMetaInsights } from '@/lib/meta';

export const maxDuration = 60;

// Consulta a Meta EN VIVO (no lee de Supabase) para el rango de fechas
// exacto que pida el dashboard. Por eso el selector de fechas siempre
// refleja el período real, no solo los ultimos 30 dias que guarda el cron.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');
  const until = searchParams.get('until');

  if (!since || !until || !/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return NextResponse.json({ error: 'Parametros since/until invalidos (formato YYYY-MM-DD).' }, { status: 400 });
  }

  const token = process.env.META_SYSTEM_USER_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !adAccountId) {
    return NextResponse.json({ error: 'Faltan META_SYSTEM_USER_TOKEN o META_AD_ACCOUNT_ID en el servidor.' }, { status: 500 });
  }

  try {
    const [campaigns, ads] = await Promise.all([
      fetchMetaInsights({ adAccountId, token, level: 'campaign', since, until }),
      fetchMetaInsights({ adAccountId, token, level: 'ad', since, until }),
    ]);

    return NextResponse.json({ ok: true, since, until, campaigns, ads });
  } catch (err: any) {
    console.error('Error en /api/insights:', err);
    return NextResponse.json({ error: err?.message || 'Error al consultar Meta.' }, { status: 500 });
  }
}
