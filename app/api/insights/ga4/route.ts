import { NextRequest, NextResponse } from 'next/server';
import { fetchGa4Insights } from '@/lib/ga4';
import { resolveAdAccount, getGa4PropertyId } from '@/lib/accounts';

export const maxDuration = 60;

// Consulta a GA4 EN VIVO (no lee de Supabase) para el rango de fechas
// exacto que pida el dashboard - mismo patron que /api/insights con Meta.
// ?account=act_... elige la propiedad de GA4 de esa cuenta (GA4_PROPERTY_IDS);
// si la cuenta no tiene una propia, se usa GA4_PROPERTY_ID.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');
  const until = searchParams.get('until');

  if (!since || !until || !/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return NextResponse.json({ error: 'Parametros since/until invalidos (formato YYYY-MM-DD).' }, { status: 400 });
  }

  const account = resolveAdAccount(searchParams.get('account'));
  const propertyId = getGa4PropertyId(account?.id);
  if (!propertyId) {
    return NextResponse.json({ error: 'Esta cuenta no tiene una propiedad de GA4 configurada (GA4_PROPERTY_IDS o GA4_PROPERTY_ID).' }, { status: 400 });
  }

  try {
    const data = await fetchGa4Insights({ since, until, propertyId });
    return NextResponse.json({ ok: true, since, until, property_id: propertyId, ...data });
  } catch (err: any) {
    console.error('Error en /api/insights/ga4:', err);
    return NextResponse.json({ error: err?.message || 'Error al consultar GA4.' }, { status: 500 });
  }
}
