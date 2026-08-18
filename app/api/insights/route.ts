import { NextRequest, NextResponse } from 'next/server';
import { fetchMetaInsights, fetchAdsetGoals, fetchCampaignStatus, fetchAdLandingUrls } from '@/lib/meta';

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
    const [campaigns, adsetsRaw, adsRaw] = await Promise.all([
      fetchMetaInsights({ adAccountId, token, level: 'campaign', since, until }),
      fetchMetaInsights({ adAccountId, token, level: 'adset', since, until }),
      fetchMetaInsights({ adAccountId, token, level: 'ad', since, until }),
    ]);

    const [goals, campaignStatus, adLandingUrls] = await Promise.all([
      fetchAdsetGoals({ adsetIds: adsetsRaw.map((a) => a.level_id), token }),
      fetchCampaignStatus({ campaignIds: campaigns.map((c) => c.level_id), token }),
      // Landing real de CADA anuncio (no un representativo) - es lo que
      // permite unificar bien mas abajo cuando un conjunto o campaña
      // tiene anuncios que apuntan a landings distintas.
      fetchAdLandingUrls({ adIds: adsRaw.map((a) => a.level_id), token }),
    ]);

    const ads = adsRaw.map((a) => ({ ...a, landing_url: adLandingUrls[a.level_id] || null }));

    // Landings unicas por conjunto (union de las de sus anuncios) y por
    // campaña (union de las de todos sus conjuntos) - asi, si dos
    // anuncios de un mismo conjunto apuntan a paginas distintas, ambas
    // quedan representadas en vez de perderse una.
    function uniqueLandingUrls(predicate: (ad: (typeof ads)[number]) => boolean): string[] {
      const set = new Set<string>();
      for (const ad of ads) {
        if (ad.landing_url && predicate(ad)) set.add(ad.landing_url);
      }
      return Array.from(set);
    }

    const adsets = adsetsRaw.map((a) => {
      const meta = goals[a.level_id];
      const landingUrls = uniqueLandingUrls((ad) => ad.adset_id === a.level_id);
      return {
        ...a,
        optimization_label: meta?.conversionLabel || null,
        status_label: meta?.status || null,
        is_active: meta?.isActive ?? null,
        start_time: meta?.startTime || null,
        end_time: meta?.endTime || null,
        landing_urls: landingUrls,
        landing_url: landingUrls[0] || null, // para el link clicable (el primero de la lista, si hay varios)
      };
    });

    const campaignsWithStatus = campaigns.map((c) => {
      const st = campaignStatus[c.level_id];
      const landingUrls = uniqueLandingUrls((ad) => ad.campaign_id === c.level_id);
      return {
        ...c,
        status_label: st?.status || null,
        is_active: st?.isActive ?? null,
        start_time: st?.startTime || null,
        end_time: st?.endTime || null,
        objective_label: st?.objectiveLabel || null,
        buying_type_label: st?.buyingTypeLabel || null,
        landing_urls: landingUrls,
        landing_url: landingUrls[0] || null,
      };
    });

    return NextResponse.json({ ok: true, since, until, campaigns: campaignsWithStatus, adsets, ads });
  } catch (err: any) {
    console.error('Error en /api/insights:', err);
    return NextResponse.json({ error: err?.message || 'Error al consultar Meta.' }, { status: 500 });
  }
}
