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

// Mapeo de los valores oficiales de Meta a etiquetas en español.
// A diferencia del "evento dominante" (que contaba acciones y podia
// equivocarse), esto lee la configuracion REAL del conjunto de anuncios.
const OPTIMIZATION_GOAL_LABELS: Record<string, string> = {
  LEAD_GENERATION: 'Generación de clientes potenciales',
  QUALITY_LEAD: 'Clientes potenciales de calidad',
  LANDING_PAGE_VIEWS: 'Visitas a la página de destino',
  LINK_CLICKS: 'Clics en el enlace',
  IMPRESSIONS: 'Impresiones',
  REACH: 'Alcance',
  THRUPLAY: 'Reproducciones completas de video',
  APP_INSTALLS: 'Instalaciones de la app',
  CONVERSATIONS: 'Conversaciones iniciadas',
  POST_ENGAGEMENT: 'Interacción con la publicación',
  VALUE: 'Valor de conversión',
  OFFSITE_CONVERSIONS: 'Conversión personalizada', // se refina abajo con promoted_object
};

const CUSTOM_EVENT_TYPE_LABELS: Record<string, string> = {
  LEAD: 'Cliente potencial',
  COMPLETE_REGISTRATION: 'Formulario completado',
  SUBMIT_APPLICATION: 'Solicitud enviada',
  SCHEDULE: 'Cita agendada',
  SUBSCRIBE: 'Suscripción',
  VIEW_CONTENT: 'Contenido visto',
  PAGE_VIEW: 'Page view',
  PURCHASE: 'Compra',
  START_TRIAL: 'Inicio de prueba',
  CONTACT: 'Contacto',
};

/**
 * Trae el objetivo de optimizacion REAL configurado en cada conjunto de
 * anuncios (no una suposicion contando acciones). Usa la API de batch de
 * Meta para resolverlos todos en una o dos llamadas, sin importar cuantos
 * conjuntos haya.
 */
export async function fetchAdsetGoals(params: { adsetIds: string[]; token: string }): Promise<Record<string, string>> {
  const { adsetIds, token } = params;
  const uniqueIds = Array.from(new Set(adsetIds)).filter(Boolean);
  if (uniqueIds.length === 0) return {};

  const batch1 = uniqueIds.map((id) => ({ method: 'GET', relative_url: `${id}?fields=optimization_goal,promoted_object` }));
  const rows = await metaBatch(batch1, token);

  const result: Record<string, string> = {};
  const customConversionIds = new Set<string>();

  uniqueIds.forEach((id, i) => {
    const body = rows[i];
    if (!body) return;
    const goal = body.optimization_goal as string | undefined;
    const promoted = body.promoted_object || {};

    if (promoted.custom_conversion_id) {
      customConversionIds.add(promoted.custom_conversion_id);
      result[id] = `__CUSTOM__${promoted.custom_conversion_id}`; // se resuelve abajo
    } else if (promoted.custom_event_type && CUSTOM_EVENT_TYPE_LABELS[promoted.custom_event_type]) {
      result[id] = CUSTOM_EVENT_TYPE_LABELS[promoted.custom_event_type];
    } else if (goal && OPTIMIZATION_GOAL_LABELS[goal]) {
      result[id] = OPTIMIZATION_GOAL_LABELS[goal];
    } else {
      result[id] = goal || 'No detectado';
    }
  });

  // Si algun conjunto usa una "conversion personalizada" (creada a mano
  // en Events Manager), su nombre real no viene en el paso anterior -
  // hay que pedirlo aparte.
  if (customConversionIds.size > 0) {
    const ccIds = Array.from(customConversionIds);
    const batch2 = ccIds.map((id) => ({ method: 'GET', relative_url: `${id}?fields=name` }));
    const ccRows = await metaBatch(batch2, token);
    const nameById: Record<string, string> = {};
    ccIds.forEach((id, i) => { nameById[id] = ccRows[i]?.name || 'Conversión personalizada'; });

    for (const adsetId of Object.keys(result)) {
      if (result[adsetId].startsWith('__CUSTOM__')) {
        const ccId = result[adsetId].replace('__CUSTOM__', '');
        result[adsetId] = nameById[ccId] || 'Conversión personalizada';
      }
    }
  }

  return result;
}

async function metaBatch(batch: { method: string; relative_url: string }[], token: string): Promise<any[]> {
  // La API de batch de Meta acepta maximo 50 solicitudes por llamada.
  const chunks: typeof batch[] = [];
  for (let i = 0; i < batch.length; i += 50) chunks.push(batch.slice(i, i + 50));

  const allBodies: any[] = [];
  for (const chunk of chunks) {
    const res = await fetch(`${BASE_URL}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token, batch: chunk }),
    });
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error(`Meta batch API error: ${JSON.stringify(json)}`);
    for (const item of json) {
      allBodies.push(item?.body ? JSON.parse(item.body) : null);
    }
  }
  return allBodies;
}
