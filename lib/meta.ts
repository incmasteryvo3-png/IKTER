// ============================================================
// Cliente minimo para la Meta Marketing API (Graph API)
// Documentacion: https://developers.facebook.com/docs/marketing-api/insights
// ============================================================

const API_VERSION = process.env.META_API_VERSION || 'v19.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

type MetaLevel = 'campaign' | 'adset' | 'ad';

const FIELDS = [
  'campaign_id', 'campaign_name',
  'adset_id', 'adset_name',
  'ad_id', 'ad_name',
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks',
  'ctr', 'cpc',
  'video_play_actions',
  'video_avg_time_watched_actions', // tiempo promedio de reproduccion (segundos)
  'actions',           // aqui vienen "resultados" (leads) y "landing_page_view"
  'cost_per_action_type',
].join(',');

/**
 * Trae insights de una cuenta publicitaria a un nivel especifico
 * (campaign | adset | ad) para un rango de fechas dado.
 */
export async function fetchMetaInsights(params: {
  adAccountId: string;      // ej: "act_123456789"
  token: string;
  level: MetaLevel;
  since: string;            // YYYY-MM-DD
  until: string;            // YYYY-MM-DD
}) {
  const { adAccountId, token, level, since, until } = params;

  const url = new URL(`${BASE_URL}/${adAccountId}/insights`);
  url.searchParams.set('level', level);
  url.searchParams.set('fields', FIELDS);
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('time_increment', 'all_days'); // un solo total para el rango
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', token);

  const results: any[] = [];
  let nextUrl: string | null = url.toString();

  while (nextUrl) {
    const res: Response = await fetch(nextUrl);
    const json: any = await res.json();

    if (json.error) {
      throw new Error(`Meta API error: ${json.error.message} (code ${json.error.code})`);
    }

    results.push(...(json.data || []));
    nextUrl = json.paging?.next || null;
  }

  return results.map((row) => normalizeRow(row, level));
}

// Convierte la fila cruda de Meta al formato que guardamos en insight_snapshots
function normalizeRow(row: any, level: MetaLevel) {
  const idKey = level === 'campaign' ? 'campaign_id' : level === 'adset' ? 'adset_id' : 'ad_id';
  const nameKey = level === 'campaign' ? 'campaign_name' : level === 'adset' ? 'adset_name' : 'ad_name';

  const results = extractResults(row.actions);
  const landingPageViews = extractLandingPageViews(row.actions);
  const videoPlays = sumActionValues(row.video_play_actions);
  const avgWatchSeconds = extractAvgWatchSeconds(row.video_avg_time_watched_actions);

  return {
    level,
    level_id: row[idKey],
    level_name: row[nameKey],
    spend: parseFloat(row.spend || '0'),
    impressions: parseInt(row.impressions || '0', 10),
    reach: parseInt(row.reach || '0', 10),
    clicks: parseInt(row.clicks || '0', 10),
    link_clicks: parseInt(row.inline_link_clicks || '0', 10),
    video_plays: videoPlays,
    video_avg_watch_seconds: avgWatchSeconds,
    // Meta no entrega "tiempo total de reproduccion" como campo directo y confiable
    // a nivel anuncio; lo aproximamos como reproducciones x tiempo promedio.
    // Es una estimacion, no un dato exacto de Meta.
    video_play_time_estimate: Math.round(videoPlays * avgWatchSeconds),
    landing_page_views: landingPageViews,
    ctr: parseFloat(row.ctr || '0'),
    cpc: parseFloat(row.cpc || '0'),
    results,
    cost_per_result: results > 0 ? parseFloat(row.spend || '0') / results : null,
    raw: row,
  };
}

// "actions" es un arreglo tipo [{action_type: 'lead', value: '3'}, ...]
// Aqui se decide cual action_type cuenta como "resultado" (personalizable)
function extractResults(actions: any[] | undefined): number {
  if (!actions) return 0;
  const relevant = actions.find((a) =>
    ['lead', 'complete_registration', 'submit_application', 'onsite_conversion.lead_grouped'].includes(a.action_type)
  );
  return relevant ? parseInt(relevant.value, 10) : 0;
}

function extractLandingPageViews(actions: any[] | undefined): number {
  if (!actions) return 0;
  const relevant = actions.find((a) => a.action_type === 'landing_page_view');
  return relevant ? parseInt(relevant.value, 10) : 0;
}

function sumActionValues(actions: any[] | undefined): number {
  if (!actions) return 0;
  return actions.reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);
}

function extractAvgWatchSeconds(actions: any[] | undefined): number {
  if (!actions || actions.length === 0) return 0;
  // Meta devuelve esto como un arreglo con un solo valor promedio (segundos)
  const value = actions[0]?.value;
  return value ? parseFloat(value) : 0;
}
