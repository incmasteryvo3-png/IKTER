import { NextRequest, NextResponse } from 'next/server';
import { fetchDailyDiagnostics, type DiagLevel } from '@/lib/metaDaily';
import { fetchAdsetGoals, fetchCampaignStatus } from '@/lib/meta';

export const maxDuration = 60;

// Alimenta la pestaña "Diagnóstico": serie DIARIA en vivo desde Meta
// (mismo patron que /api/insights, que sigue intacto para el Dashboard).
// GET /api/insights/daily?since=YYYY-MM-DD&until=YYYY-MM-DD&level=ad|adset|campaign&campaign_ids=ID1,ID2,ID3
// (campaign_ids = las campañas elegidas en el Dashboard; la pestaña Diagnóstico siempre lo manda)
const MAX_DAYS = 93;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');
  const until = searchParams.get('until');
  const levelParam = searchParams.get('level') || 'ad';

  if (!since || !until || !/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return NextResponse.json({ error: 'Parametros since/until invalidos (formato YYYY-MM-DD).' }, { status: 400 });
  }
  if (!['ad', 'adset', 'campaign'].includes(levelParam)) {
    return NextResponse.json({ error: 'Parametro level invalido (ad, adset o campaign).' }, { status: 400 });
  }
  const days = (Date.parse(until) - Date.parse(since)) / 86400000 + 1;
  if (days < 1) return NextResponse.json({ error: 'La fecha final es anterior a la inicial.' }, { status: 400 });
  if (days > MAX_DAYS) {
    return NextResponse.json({ error: `El diagnóstico diario admite hasta ${MAX_DAYS} días por consulta (pediste ${days}). Acorta el rango.` }, { status: 400 });
  }

  const token = process.env.META_SYSTEM_USER_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !adAccountId) {
    return NextResponse.json({ error: 'Faltan META_SYSTEM_USER_TOKEN o META_AD_ACCOUNT_ID en el servidor.' }, { status: 500 });
  }

  const level = levelParam as DiagLevel;
  const campaignIds = (searchParams.get('campaign_ids') || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (campaignIds.some((id) => !/^\d+$/.test(id)) || campaignIds.length > 10) {
    return NextResponse.json({ error: 'Parametro campaign_ids invalido.' }, { status: 400 });
  }

  try {
    const { dates, entities } = await fetchDailyDiagnostics({ adAccountId, token, level, since, until, campaignIds });

    // Evento de conversion REAL (mismo origen que el Dashboard): objetivo
    // de optimizacion del conjunto, u objetivo de la campaña.
    let labels: Record<string, string | null> = {};
    try {
      if (level === 'campaign') {
        const st = await fetchCampaignStatus({ campaignIds: entities.map((e) => e.id), token });
        entities.forEach((e) => { labels[e.id] = st[e.id]?.objectiveLabel || null; });
      } else {
        const goals = await fetchAdsetGoals({ adsetIds: entities.map((e) => e.adset_id || '').filter(Boolean), token });
        entities.forEach((e) => { labels[e.id] = (e.adset_id && goals[e.adset_id]?.conversionLabel) || null; });
      }
    } catch {
      labels = {}; // si esto falla, las graficas igual se muestran
    }

    return NextResponse.json({
      ok: true, since, until, level, dates,
      entities: entities.map((e) => ({ ...e, evento: labels[e.id] || null })),
    });
  } catch (err: any) {
    console.error('Error en /api/insights/daily:', err);
    return NextResponse.json({ error: err?.message || 'Error al consultar Meta.' }, { status: 500 });
  }
}
