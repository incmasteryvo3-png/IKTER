import { NextRequest, NextResponse } from 'next/server';
import { fetchMetaInsights, fetchAdsetGoals, fetchCampaignStatus } from '@/lib/meta';

export const maxDuration = 60;

// Consulta a Meta EN VIVO (no lee de Supabase) para el rango de fechas
// exacto que pida el dashboard. Trae los 3 niveles: campaign, adset y ad,
// mas el objetivo de optimizacion REAL de cada conjunto (no inferido).
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
    const [campaigns, adsetsRaw, ads] = await Promise.all([
      fetchMetaInsights({ adAccountId, token, level: 'campaign', since, until }),
      fetchMetaInsights({ adAccountId, token, level: 'adset', since, until }),
      fetchMetaInsights({ adAccountId, token, level: 'ad', since, until }),
    ]);

    const [goals, campaignStatus] = await Promise.all([
      fetchAdsetGoals({ adsetIds: adsetsRaw.map((a) => a.level_id), token }),
      fetchCampaignStatus({ campaignIds: campaigns.map((c) => c.level_id), token }),
    ]);

    const adsets = adsetsRaw.map((a) => {
      const meta = goals[a.level_id];
      return {
        ...a,
        optimization_label: meta?.conversionLabel || null,
        status_label: meta?.status || null,
        is_active: meta?.isActive ?? null,
        start_time: meta?.startTime || null,
        end_time: meta?.endTime || null,
      };
    });

    const campaignsWithStatus = campaigns.map((c) => {
      const st = campaignStatus[c.level_id];
      return {
        ...c,
        status_label: st?.status || null,
        is_active: st?.isActive ?? null,
        start_time: st?.startTime || null,
        end_time: st?.endTime || null,
      };
    });

    return NextResponse.json({ ok: true, since, until, campaigns: campaignsWithStatus, adsets, ads });
  } catch (err: any) {
    console.error('Error en /api/insights:', err);
    return NextResponse.json({ error: err?.message || 'Error al consultar Meta.' }, { status: 500 });
  }
}
