// ============================================================
// Cliente minimo para la Meta Marketing API (Graph API)
// ============================================================

const API_VERSION = process.env.META_API_VERSION || 'v19.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export type MetaLevel = 'campaign' | 'adset' | 'ad';

const FIELDS = [
  'campaign_id', 'campaign_name',
  'adset_id', 'adset_name',
  'ad_id', 'ad_name',
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks',
  'ctr', 'cpc',
  'video_play_actions',
  'video_avg_time_watched_actions',
  'actions',
  'cost_per_action_type',
].join(',');

export async function fetchMetaInsights(params: {
  adAccountId: string;
  token: string;
  level: MetaLevel;
  since: string;
  until: string;
}) {
  const { adAccountId, token, level, since, until } = params;

  const url = new URL(`${BASE_URL}/${adAccountId}/insights`);
  url.searchParams.set('level', level);
  url.searchParams.set('fields', FIELDS);
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('time_increment', 'all_days');
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

function normalizeRow(row: any, level: MetaLevel) {
  const idKey = level === 'campaign' ? 'campaign_id' : level === 'adset' ? 'adset_id' : 'ad_id';
  const nameKey = level === 'campaign' ? 'campaign_name' : level === 'adset' ? 'adset_name' : 'ad_name';

  const results = extractResults(row.actions);
  const landingPageViews = extractActionCount(row.actions, ['landing_page_view']);
  const videoPlays = sumActionValues(row.video_play_actions);
  const avgWatchSeconds = extractAvgWatchSeconds(row.video_avg_time_watched_actions);

  return {
    level,
    level_id: row[idKey],
    level_name: row[nameKey],
    campaign_id: row.campaign_id, // se guarda siempre, para filtrar adsets/anuncios por campaña
    adset_id: row.adset_id,       // se guarda siempre, para filtrar anuncios por conjunto
    spend: parseFloat(row.spend || '0'),
    impressions: parseInt(row.impressions || '0', 10),
    reach: parseInt(row.reach || '0', 10),
    clicks: parseInt(row.clicks || '0', 10),
    link_clicks: parseInt(row.inline_link_clicks || '0', 10),
    video_plays: videoPlays,
    video_avg_watch_seconds: avgWatchSeconds,
    video_play_time_estimate: Math.round(videoPlays * avgWatchSeconds),
    landing_page_views: landingPageViews,
    ctr: parseFloat(row.ctr || '0'),
    cpc: parseFloat(row.cpc || '0'),
    results,
    cost_per_result: results > 0 ? parseFloat(row.spend || '0') / results : null,
    actions: row.actions || [], // arreglo crudo, para poder mostrar cada evento de conversion por separado
    raw: row,
  };
}

function extractResults(actions: any[] | undefined): number {
  if (!actions) return 0;
  const relevant = actions.find((a) =>
    ['lead', 'complete_registration', 'submit_application', 'onsite_conversion.lead_grouped'].includes(a.action_type)
  );
  return relevant ? parseInt(relevant.value, 10) : 0;
}

function extractActionCount(actions: any[] | undefined, types: string[]): number {
  if (!actions) return 0;
  const relevant = actions.find((a) => types.includes(a.action_type));
  return relevant ? parseInt(relevant.value, 10) : 0;
}

function sumActionValues(actions: any[] | undefined): number {
  if (!actions) return 0;
  return actions.reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);
}

function extractAvgWatchSeconds(actions: any[] | undefined): number {
  if (!actions || actions.length === 0) return 0;
  const value = actions[0]?.value;
  return value ? parseFloat(value) : 0;
}
