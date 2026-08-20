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
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'unique_inline_link_clicks',
  'ctr', 'cpc',
  'video_play_actions',
  'video_avg_time_watched_actions',
  'actions',
  'cost_per_action_type',
  'conversions', 'cost_per_conversion',
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

  const { count: results, costPerResult } = extractResults(row.actions, row.conversions, row.cost_per_conversion, parseFloat(row.spend || '0'));
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
    unique_link_clicks: parseInt(row.unique_inline_link_clicks || '0', 10),
    post_engagement: extractActionCount(row.actions, ['post_engagement']),
    video_plays: videoPlays,
    video_avg_watch_seconds: avgWatchSeconds,
    video_play_time_estimate: Math.round(videoPlays * avgWatchSeconds),
    landing_page_views: landingPageViews,
    ctr: parseFloat(row.ctr || '0'),
    cpc: parseFloat(row.cpc || '0'), // costo por clic (TODOS los clics) - directo de Meta
    // Costo por clic en el enlace y costo por visita a la landing: Meta
    // los trae dentro de "cost_per_action_type" (el mismo arreglo que
    // "actions" pero de costos) - se leen de ahi, no se calculan.
    // OJO: el que trae Meta es "costo por clic en el enlace" (todos los
    // clics en el enlace), no existe un campo de Meta separado para
    // "costo por clic UNICO en el enlace" - por eso este numero se
    // empareja con link_clicks (todos), no con unique_link_clicks. Esto
    // se decidio asi para no inventar una division que Meta no ofrece.
    cost_per_link_click: extractActionCost(row.cost_per_action_type, ['link_click']),
    cost_per_landing_page_view: extractActionCost(row.cost_per_action_type, ['landing_page_view']),
    results,
    cost_per_result: costPerResult, // directo de Meta (cost_per_conversion), no calculado
    actions: row.actions || [], // arreglo crudo, para poder mostrar cada evento de conversion por separado
    conversions_raw: row.conversions || [], // arreglo crudo del campo "conversions" (diagnostico)
    raw: row,
  };
}

// Devuelve el conteo de resultados Y su costo, ambos leidos directo de
// los campos que Meta reserva para esto ("conversions" /
// "cost_per_conversion") - nunca calculados por IKTER.
function extractResults(
  actions: any[] | undefined,
  conversions: any[] | undefined,
  costPerConversion: any[] | undefined,
  spend: number
): { count: number; costPerResult: number | null } {
  // "conversions" es el campo que Meta reserva especificamente para el
  // evento configurado como objetivo de optimizacion del conjunto -
  // es lo que Ads Manager usa para pintar la columna "Resultados", a
  // diferencia de "actions" que es un listado generico de todo lo que
  // paso (y donde varios eventos de pixel personalizados quedan
  // mezclados bajo un mismo nombre generico). Si Meta trae algo aca,
  // se usa esto primero.
  if (conversions && conversions.length > 0) {
    // Si el conjunto esta optimizado a un solo evento (el caso normal),
    // deberia venir una sola entrada. Si vienen varias (cuenta con mas
    // de un evento de conversion activo), se toma la de mayor valor -
    // es la interpretacion mas razonable sin poder preguntarle a Meta
    // cual es "la" oficial desde este campo.
    const best = conversions.reduce((m, c) => (parseInt(c.value || '0', 10) > parseInt(m.value || '0', 10) ? c : m), conversions[0]);
    const count = parseInt(best.value || '0', 10);
    // El costo correspondiente a ESE MISMO action_type, tambien directo
    // de Meta (no se calcula spend/count).
    const costEntry = (costPerConversion || []).find((c) => c.action_type === best.action_type);
    const costPerResult = costEntry ? parseFloat(costEntry.value) : null;
    return { count, costPerResult };
  }

  // Respaldo: los 4 tipos de "actions" ya confirmados contra datos
  // reales para leads/registros/solicitudes. Aca si toca calcular el
  // costo (spend/count) porque no hay "cost_per_conversion" que
  // acompañe a "actions" - es el unico caso donde no queda otra.
  if (!actions) return { count: 0, costPerResult: null };
  const relevant = actions.find((a) =>
    ['lead', 'complete_registration', 'submit_application', 'onsite_conversion.lead_grouped'].includes(a.action_type)
  );
  const count = relevant ? parseInt(relevant.value, 10) : 0;
  return { count, costPerResult: count > 0 ? spend / count : null };
}

function extractActionCount(actions: any[] | undefined, types: string[]): number {
  if (!actions) return 0;
  const relevant = actions.find((a) => types.includes(a.action_type));
  return relevant ? parseInt(relevant.value, 10) : 0;
}

// Igual que extractActionCount, pero para el arreglo de COSTOS
// ("cost_per_action_type") que Meta manda por separado - confirmado
// contra datos reales que trae, entre otros, "link_click" y
// "landing_page_view" ya calculados por Meta.
function extractActionCost(costPerActionType: any[] | undefined, types: string[]): number | null {
  if (!costPerActionType) return null;
  const relevant = costPerActionType.find((a) => types.includes(a.action_type));
  return relevant ? parseFloat(relevant.value) : null;
}

function sumActionValues(actions: any[] | undefined): number {
  if (!actions) return 0;
  return actions.reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);
}

// ============================================================
// REGLA DE ORO: nunca se muestra una traduccion que no este
// confirmada palabra por palabra contra lo que Meta muestra en su
// propia interfaz. Si un valor no esta en este diccionario, se
// muestra el nombre tecnico crudo (ej. "SUBSCRIBE") en vez de
// arriesgar una traduccion que podria estar mal. Asi nunca hay
// margen de duda: o es exacto, o se ve claramente como "sin traducir"
// y se sabe que hay que agregarlo aqui.
//
// Como agregar un evento nuevo: cuando aparezca un valor en mayusculas
// sin traducir (ej. "SCHEDULE") en el dashboard, revisa el desplegable
// "Evento de conversion" de ese conjunto en Meta Ads Manager, copia el
// texto EXACTO que ahi aparece, y agrega la linea correspondiente abajo.
// ============================================================
const OPTIMIZATION_GOAL_LABELS: Record<string, string> = {
  LINK_CLICKS: 'Clics en el enlace',
  IMPRESSIONS: 'Impresiones',
  REACH: 'Alcance',
  LANDING_PAGE_VIEWS: 'Visitas a la página de destino',
  THRUPLAY: 'Reproducciones de video ThruPlay',
  // OFFSITE_CONVERSIONS y similares NO se traducen aqui a proposito:
  // en esos casos el evento real y mas especifico viene de
  // promoted_object (custom_event_type o custom_conversion_id), que
  // es lo que de verdad configuraste, no la categoria general.
};

// Confirmado contra la interfaz real de Meta (Ads Manager en español),
// verificado captura por captura junto con Mastery. Solo se agregan
// entradas aqui cuando estan 100% confirmadas.
const CUSTOM_EVENT_TYPE_LABELS: Record<string, string> = {
  SUBSCRIBE: 'Suscribirse', // confirmado 25/jul/2026 en conjunto "SCALE ONE - Copia"
};

// Objetivo de la campaña (campo "objective") - misma regla de oro: si no
// esta 100% confirmado el texto exacto de Ads Manager, se muestra el
// valor tecnico crudo en vez de arriesgar una traduccion.
const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_LEADS: 'Generación de clientes potenciales',
  OUTCOME_SALES: 'Ventas',
  OUTCOME_ENGAGEMENT: 'Interacción',
  OUTCOME_AWARENESS: 'Reconocimiento de marca',
  OUTCOME_TRAFFIC: 'Tráfico',
  OUTCOME_APP_PROMOTION: 'Promoción de la app',
  // Nombres antiguos (campañas creadas antes de la reorganizacion de
  // objetivos de Meta) - se mantienen por si aparece alguna asi:
  LEAD_GENERATION: 'Generación de clientes potenciales',
  CONVERSIONS: 'Conversiones',
  LINK_CLICKS: 'Clics en el enlace',
  REACH: 'Alcance',
  BRAND_AWARENESS: 'Reconocimiento de marca',
  VIDEO_VIEWS: 'Reproducciones de video',
  MESSAGES: 'Mensajes',
  APP_INSTALLS: 'Instalaciones de la app',
  POST_ENGAGEMENT: 'Interacción con la publicación',
};

const BUYING_TYPE_LABELS: Record<string, string> = {
  AUCTION: 'Subasta',
  RESERVED: 'Alcance y frecuencia (reservado)',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  PAUSED: 'Pausado',
  ADSET_PAUSED: 'Pausado',
  CAMPAIGN_PAUSED: 'Pausado (por la campaña)',
  ARCHIVED: 'Archivado',
  DELETED: 'Eliminado',
  IN_PROCESS: 'En revisión',
  WITH_ISSUES: 'Con problemas',
  PENDING_REVIEW: 'En revisión',
  DISAPPROVED: 'Rechazado',
};

export type EntityStatus = {
  status: string;
  isActive: boolean;
  startTime: string | null;
  endTime: string | null;
  objectiveLabel?: string | null;
  buyingTypeLabel?: string | null;
};

/**
 * Trae el estado (activo/pausado) y las fechas de programacion reales
 * de un conjunto de campañas, en un solo lote. Nota: en el objeto
 * "campaign" de Meta el campo de fecha de fin se llama "stop_time",
 * a diferencia de "adset" que usa "end_time" - por eso esta funcion es
 * separada de fetchAdsetGoals en vez de compartir el mismo query.
 */
export async function fetchCampaignStatus(params: { campaignIds: string[]; token: string }): Promise<Record<string, EntityStatus>> {
  const { campaignIds, token } = params;
  const uniqueIds = Array.from(new Set(campaignIds)).filter(Boolean);
  if (uniqueIds.length === 0) return {};

  const batch = uniqueIds.map((id) => ({ method: 'GET', relative_url: `${id}?fields=effective_status,start_time,stop_time,objective,buying_type` }));
  const rows = await metaBatch(batch, token);

  const result: Record<string, EntityStatus> = {};
  uniqueIds.forEach((id, i) => {
    const body = rows[i];
    if (!body) return;
    const effectiveStatus = body.effective_status as string | undefined;
    const objective = body.objective as string | undefined;
    const buyingType = body.buying_type as string | undefined;
    result[id] = {
      status: (effectiveStatus && STATUS_LABELS[effectiveStatus]) || effectiveStatus || 'Desconocido',
      isActive: effectiveStatus === 'ACTIVE',
      startTime: body.start_time || null,
      endTime: body.stop_time || null,
      objectiveLabel: objective ? (OBJECTIVE_LABELS[objective] || `${objective} (sin traducir)`) : null,
      buyingTypeLabel: buyingType ? (BUYING_TYPE_LABELS[buyingType] || `${buyingType} (sin traducir)`) : null,
    };
  });
  return result;
}

export type AdsetMeta = {
  conversionLabel: string;
  status: string;        // ya traducido cuando se conoce, o el valor crudo
  isActive: boolean;
  startTime: string | null;
  endTime: string | null;
};

/**
 * Trae el objetivo de optimizacion, el estado (activo/pausado) y las
 * fechas de programacion REALES de cada conjunto de anuncios - todo en
 * el mismo lote de llamadas. Nada de esto se adivina.
 */
export async function fetchAdsetGoals(params: { adsetIds: string[]; token: string }): Promise<Record<string, AdsetMeta>> {
  const { adsetIds, token } = params;
  const uniqueIds = Array.from(new Set(adsetIds)).filter(Boolean);
  if (uniqueIds.length === 0) return {};

  const batch1 = uniqueIds.map((id) => ({
    method: 'GET',
    relative_url: `${id}?fields=optimization_goal,promoted_object,effective_status,start_time,end_time`,
  }));
  const rows = await metaBatch(batch1, token);

  const result: Record<string, AdsetMeta> = {};
  const customConversionIds = new Set<string>();

  uniqueIds.forEach((id, i) => {
    const body = rows[i];
    if (!body) return;
    const goal = body.optimization_goal as string | undefined;
    const promoted = body.promoted_object || {};
    const effectiveStatus = body.effective_status as string | undefined;

    let conversionLabel: string;
    if (promoted.custom_conversion_id) {
      // Conversion personalizada creada por Mastery en Events Manager:
      // el nombre exacto se trae directo de Meta, sin traducir nada.
      customConversionIds.add(promoted.custom_conversion_id);
      conversionLabel = `__CUSTOM__${promoted.custom_conversion_id}`; // se resuelve abajo
    } else if (promoted.custom_event_type && CUSTOM_EVENT_TYPE_LABELS[promoted.custom_event_type]) {
      conversionLabel = CUSTOM_EVENT_TYPE_LABELS[promoted.custom_event_type];
    } else if (promoted.custom_event_type) {
      // Evento estandar de Meta, pero aun sin confirmar su traduccion
      // exacta -> se muestra el valor tecnico crudo, nunca una
      // traduccion adivinada.
      conversionLabel = `${promoted.custom_event_type} (sin traducir)`;
    } else if (goal && OPTIMIZATION_GOAL_LABELS[goal]) {
      conversionLabel = OPTIMIZATION_GOAL_LABELS[goal];
    } else {
      conversionLabel = goal ? `${goal} (sin traducir)` : 'No detectado';
    }

    result[id] = {
      conversionLabel,
      status: (effectiveStatus && STATUS_LABELS[effectiveStatus]) || effectiveStatus || 'Desconocido',
      isActive: effectiveStatus === 'ACTIVE',
      startTime: body.start_time || null,
      endTime: body.end_time || null,
    };
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
      if (result[adsetId].conversionLabel.startsWith('__CUSTOM__')) {
        const ccId = result[adsetId].conversionLabel.replace('__CUSTOM__', '');
        result[adsetId].conversionLabel = nameById[ccId] || 'Conversión personalizada';
      }
    }
  }

  return result;
}

/**
 * Trae la URL de destino (landing page) real de CADA anuncio, leyendo su
 * creatividad. Se pide anuncio por anuncio (no un representativo por
 * conjunto) porque un mismo conjunto puede tener anuncios que apuntan a
 * landings distintas - y esa es justo la data que se necesita para poder
 * unificar/sumar correctamente a nivel de conjunto y de campaña despues.
 * No se adivina: si Meta no trae un link reconocible en la creatividad,
 * se devuelve null para ese anuncio.
 */
export async function fetchAdLandingUrls(params: {
  adIds: string[];
  token: string;
}): Promise<Record<string, string | null>> {
  const { adIds, token } = params;
  const uniqueIds = Array.from(new Set(adIds)).filter(Boolean);
  if (uniqueIds.length === 0) return {};

  const batch = uniqueIds.map((adId) => ({
    method: 'GET',
    relative_url: `${adId}?fields=creative{object_story_spec,asset_feed_spec{link_urls,bodies,titles,images,videos,call_to_action_types},effective_object_story_id}`,
  }));
  const rows = await metaBatch(batch, token);

  const result: Record<string, string | null> = {};
  // Anuncios que usan una publicacion YA EXISTENTE de la pagina (sin
  // object_story_spec propio) - confirmado con un anuncio real: la
  // creatividad solo trae "effective_object_story_id", nada de link.
  // Para estos se necesita una segunda llamada, aparte, a esa
  // publicacion puntual para leer su link real.
  const postIdByAdId: Record<string, string> = {};

  uniqueIds.forEach((adId, i) => {
    const creative = rows[i]?.creative;
    // El orden importa: link_data.call_to_action.value.link es el link
    // REAL detrás del botón de "Llamada a la accion" del anuncio (lo
    // que ve la persona al hacer clic) - confirmado contra una captura
    // real donde este link (pesoenpauta.incmastery.com) era distinto al
    // de link_data.link (que apuntaba a un widget de calendario de
    // leadconnectorhq.com, no a la landing real). Por eso ahora se
    // revisa primero el de la llamada a la accion, y solo se cae al
    // link_data.link base si el anuncio no tiene ese campo.
    const link: string | null =
      creative?.object_story_spec?.link_data?.call_to_action?.value?.link ||
      creative?.object_story_spec?.link_data?.link ||
      creative?.object_story_spec?.video_data?.call_to_action?.value?.link ||
      creative?.asset_feed_spec?.link_urls?.[0]?.website_url ||
      creative?.asset_feed_spec?.videos?.[0]?.call_to_action?.[0]?.value?.link ||
      null;

    if (link) {
      result[adId] = link;
    } else if (creative?.effective_object_story_id) {
      result[adId] = null; // se completa abajo, con la segunda llamada
      postIdByAdId[adId] = creative.effective_object_story_id;
    } else {
      result[adId] = null;
    }
  });

  // Segunda llamada: leer el link real de cada publicacion de pagina
  // que se identifico arriba. Se piden "link" (posts tipo link simple)
  // y "attachments{url,unshimmed_url}" (posts con adjuntos, ej. cuando
  // el link viene dentro de una tarjeta/carrusel).
  const postIds = Object.entries(postIdByAdId);
  if (postIds.length > 0) {
    const postBatch = postIds.map(([, postId]) => ({
      method: 'GET',
      relative_url: `${postId}?fields=link,attachments{url,unshimmed_url}`,
    }));
    const postRows = await metaBatch(postBatch, token);
    postIds.forEach(([adId], i) => {
      const post = postRows[i];
      const link: string | null =
        post?.link ||
        post?.attachments?.data?.[0]?.unshimmed_url ||
        post?.attachments?.data?.[0]?.url ||
        null;
      result[adId] = link;
    });
  }

  return result;
}

function extractAvgWatchSeconds(actions: any[] | undefined): number {
  if (!actions || actions.length === 0) return 0;
  const value = actions[0]?.value;
  return value ? parseFloat(value) : 0;
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
