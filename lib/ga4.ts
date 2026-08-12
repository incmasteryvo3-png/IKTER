// ============================================================
// Cliente minimo para la Google Analytics Data API (GA4).
// Usa una cuenta de servicio de Google Cloud (mismo patron que
// lib/meta.ts: nada de estado, solo funciones que reciben un rango
// de fechas y devuelven datos ya normalizados).
// ============================================================

import { JWT } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];
const API_BASE = 'https://analyticsdata.googleapis.com/v1beta';

let cachedClient: JWT | null = null;

function getClient(): JWT {
  if (cachedClient) return cachedClient;

  const email = process.env.GA4_SERVICE_ACCOUNT_EMAIL;
  // La clave privada llega desde el entorno con "\n" literales en vez de
  // saltos de linea reales (asi hay que guardarla en Vercel/GitHub
  // Secrets) - por eso se reemplaza antes de usarla.
  const key = (process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error('Faltan GA4_SERVICE_ACCOUNT_EMAIL o GA4_SERVICE_ACCOUNT_PRIVATE_KEY en el servidor.');
  }

  cachedClient = new JWT({ email, key, scopes: SCOPES });
  return cachedClient;
}

async function runReport(body: Record<string, unknown>) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error('Falta GA4_PROPERTY_ID en el servidor.');

  const client = getClient();
  const url = `${API_BASE}/properties/${propertyId}:runReport`;

  let res;
  try {
    res = await client.request({ url, method: 'POST', data: body });
  } catch (err: any) {
    // google-auth-library mete el cuerpo del error de Google dentro de
    // err.response.data - sin esto el mensaje es un generico "Request
    // failed with status code 400" que no dice nada util.
    const detail = err?.response?.data?.error?.message;
    throw new Error(`Error de GA4 Data API: ${detail || err.message}`);
  }

  return res.data as {
    dimensionHeaders?: { name: string }[];
    metricHeaders?: { name: string }[];
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };
}

// Convierte las filas crudas (dimensionValues/metricValues por posicion)
// en objetos planos {nombreDimension: valor, nombreMetrica: valor}.
function normalizeRows(report: Awaited<ReturnType<typeof runReport>>): Record<string, string>[] {
  const dims = (report.dimensionHeaders || []).map((d) => d.name);
  const mets = (report.metricHeaders || []).map((m) => m.name);
  return (report.rows || []).map((row) => {
    const out: Record<string, string> = {};
    dims.forEach((name, i) => { out[name] = row.dimensionValues[i]?.value ?? ''; });
    mets.forEach((name, i) => { out[name] = row.metricValues[i]?.value ?? '0'; });
    return out;
  });
}

const OVERVIEW_METRICS = [
  'sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'engagementRate',
  'averageSessionDuration', 'conversions', 'eventCount', 'screenPageViews', 'bounceRate',
];

export type Ga4Overview = {
  sessions: number;
  total_users: number;
  new_users: number;
  engaged_sessions: number;
  engagement_rate: number;
  avg_session_duration: number;
  conversions: number;
  event_count: number;
  screen_page_views: number;
  bounce_rate: number;
};

// KPIs generales del sitio para el rango de fechas exacto.
export async function fetchGa4Overview(params: { since: string; until: string }): Promise<Ga4Overview> {
  const report = await runReport({
    dateRanges: [{ startDate: params.since, endDate: params.until }],
    metrics: OVERVIEW_METRICS.map((name) => ({ name })),
  });
  const row = normalizeRows(report)[0] || {};
  return {
    sessions: parseInt(row.sessions || '0', 10),
    total_users: parseInt(row.totalUsers || '0', 10),
    new_users: parseInt(row.newUsers || '0', 10),
    engaged_sessions: parseInt(row.engagedSessions || '0', 10),
    engagement_rate: parseFloat(row.engagementRate || '0'),
    avg_session_duration: parseFloat(row.averageSessionDuration || '0'),
    conversions: parseInt(row.conversions || '0', 10),
    event_count: parseInt(row.eventCount || '0', 10),
    screen_page_views: parseInt(row.screenPageViews || '0', 10),
    bounce_rate: parseFloat(row.bounceRate || '0'),
  };
}

export type Ga4Channel = {
  channel: string;
  sessions: number;
  conversions: number;
  engagement_rate: number;
  new_users: number;
};

// Desglose de trafico por canal (Paid Social, Organic Search, Direct,
// Referral, etc.) - esto es lo que permite comparar el trafico que
// viene de Meta contra el resto de canales, sin necesitar la API de
// Meta para nada: GA4 ya lo clasifica solo usando UTMs/click IDs.
export async function fetchGa4Channels(params: { since: string; until: string }): Promise<Ga4Channel[]> {
  const report = await runReport({
    dateRanges: [{ startDate: params.since, endDate: params.until }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'engagementRate' }, { name: 'newUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: '20',
  });
  return normalizeRows(report).map((r) => ({
    channel: r.sessionDefaultChannelGroup || '(sin clasificar)',
    sessions: parseInt(r.sessions || '0', 10),
    conversions: parseInt(r.conversions || '0', 10),
    engagement_rate: parseFloat(r.engagementRate || '0'),
    new_users: parseInt(r.newUsers || '0', 10),
  }));
}

export type Ga4Source = {
  source_medium: string;
  campaign: string;
  sessions: number;
  conversions: number;
  engagement_rate: number;
};

// Desglose mas fino por origen/medio + nombre de campaña - sirve para
// ver, dentro de "Paid Social", exactamente que campaña de Meta trajo
// el trafico (siempre que los anuncios lleven UTMs, ver nota en README).
export async function fetchGa4Sources(params: { since: string; until: string }): Promise<Ga4Source[]> {
  const report = await runReport({
    dateRanges: [{ startDate: params.since, endDate: params.until }],
    dimensions: [{ name: 'sessionSourceMedium' }, { name: 'sessionCampaignName' }],
    metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'engagementRate' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: '25',
  });
  return normalizeRows(report).map((r) => ({
    source_medium: r.sessionSourceMedium || '(sin datos)',
    campaign: r.sessionCampaignName || '(sin campaña)',
    sessions: parseInt(r.sessions || '0', 10),
    conversions: parseInt(r.conversions || '0', 10),
    engagement_rate: parseFloat(r.engagementRate || '0'),
  }));
}

export type Ga4LandingPage = {
  landing_page: string;
  sessions: number;
  conversions: number;
  bounce_rate: number;
  avg_session_duration: number;
};

// Paginas de destino con mas trafico - util para ver cuales landings
// (muchas veces las mismas que reciben trafico pago de Meta) convierten
// mejor o peor.
export async function fetchGa4LandingPages(params: { since: string; until: string }): Promise<Ga4LandingPage[]> {
  const report = await runReport({
    dateRanges: [{ startDate: params.since, endDate: params.until }],
    dimensions: [{ name: 'landingPage' }],
    metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'bounceRate' }, { name: 'averageSessionDuration' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: '15',
  });
  return normalizeRows(report).map((r) => ({
    landing_page: r.landingPage || '/',
    sessions: parseInt(r.sessions || '0', 10),
    conversions: parseInt(r.conversions || '0', 10),
    bounce_rate: parseFloat(r.bounceRate || '0'),
    avg_session_duration: parseFloat(r.averageSessionDuration || '0'),
  }));
}

// Junta los 4 reportes en una sola llamada, igual que /api/insights
// hace con Meta (campaign+adset+ad en paralelo).
export async function fetchGa4Insights(params: { since: string; until: string }) {
  const [overview, channels, sources, landingPages] = await Promise.all([
    fetchGa4Overview(params),
    fetchGa4Channels(params),
    fetchGa4Sources(params),
    fetchGa4LandingPages(params),
  ]);
  return { overview, channels, sources, landing_pages: landingPages };
}
