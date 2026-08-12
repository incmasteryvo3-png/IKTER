import { NextRequest, NextResponse } from 'next/server';
import { fetchGa4Insights } from '@/lib/ga4';

export const maxDuration = 60;

// Consulta a GA4 EN VIVO (no lee de Supabase) para el rango de fechas
// exacto que pida el dashboard - mismo patron que /api/insights con Meta.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');
  const until = searchParams.get('until');

  if (!since || !until || !/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return NextResponse.json({ error: 'Parametros since/until invalidos (formato YYYY-MM-DD).' }, { status: 400 });
  }

  try {
    const data = await fetchGa4Insights({ since, until });
    return NextResponse.json({ ok: true, since, until, ...data });
  } catch (err: any) {
    console.error('Error en /api/insights/ga4:', err);
    return NextResponse.json({ error: err?.message || 'Error al consultar GA4.' }, { status: 500 });
  }
}
