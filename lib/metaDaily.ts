// ============================================================
// Serie DIARIA de Meta para la pestaña "Diagnóstico".
//
// Archivo nuevo y aislado a proposito: no toca nada de lib/meta.ts
// (que alimenta el Dashboard). Solo reutiliza extractResults para que
// "Resultados" y "Costo por resultado" se lean EXACTAMENTE igual que
// en el Dashboard (primero el campo "conversions" de Meta, despues el
// respaldo por "actions").
// ============================================================
import { extractResults } from '@/lib/meta';

const API_VERSION = process.env.META_API_VERSION || 'v19.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export type DiagLevel = 'campaign' | 'adset' | 'ad';

const DAILY_FIELDS = [
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'date_start', 'spend', 'impressions', 'reach', 'frequency', 'clicks',
  'inline_link_clicks', 'ctr', 'cpm', 'actions', 'conversions', 'cost_per_conversion',
].join(',');

const VIDEO_FIELDS = [
  'campaign_id', 'adset_id', 'ad_id',
  'impressions', 'video_play_actions', 'video_avg_time_watched_actions',
  'video_p25_watched_actions', 'video_p50_watched_actions',
  'video_p75_watched_actions', 'video_p100_watched_actions',
  'video_thruplay_watched_actions',
].join(',');

async function fetchAllPages(url: URL): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = url.toString();
  while (next) {
    const res: Response = await fetch(next);
    const json: any = await res.json();
    if (json.error) throw new Error(`Meta API error: ${json.error.message} (code ${json.error.code})`);
    out.push(...(json.data || []));
    next = json.paging?.next || null;
  }
  return out;
}

function sumActions(arr: any[] | undefined): number {
  if (!arr) return 0;
  return arr.reduce((s, a) => s + parseInt(a.value || '0', 10), 0);
}
function num(v: any): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function round(n: number | null, d = 2): number | null {
  if (n === null || !isFinite(n)) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

/** Todas las fechas YYYY-MM-DD entre since y until (inclusive). */
export function dateRange(since: string, until: string): string[] {
  const out: string[] = [];
  const d = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export type DailySeries = {
  impresiones: (number | null)[];
  alcance: (number | null)[];
  frecuencia: (number | null)[];
  cpm: (number | null)[];
  ctr: (number | null)[];
  clics: (number | null)[];
  clics_enlace: (number | null)[];
  gasto: (number | null)[];
  resultados: (number | null)[];
  costo_resultado: (number | null)[];
};

export type VideoStats = {
  reproducciones: number;
  tiempo_prom: number;      // segundos
  thruplays: number;
  r25: number | null;       // % de reproducciones que llegaron al 25% del video
  r50: number | null;
  r75: number | null;
  r100: number | null;
};

export type DiagEntity = {
  id: string;
  name: string;
  level: DiagLevel;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  inicio: string | null;     // primer dia con impresiones > 0 en el rango
  fin: string | null;        // ultimo dia con impresiones > 0 en el rango
  totales: { gasto: number; impresiones: number; resultados: number; clics_enlace: number };
  series: DailySeries;
  video: VideoStats | null;
};

/**
 * Trae la serie diaria (time_increment=1) del nivel pedido y el agregado
 * de video del periodo completo (Meta no reporta la retencion de video
 * de forma confiable dia por dia, por eso va aparte y agregada).
 *
 * Un dia SIN fila de Meta queda como null (no 0): asi el frontend puede
 * dibujar la franja rayada de "dia sin datos exportados".
 */
export async function fetchDailyDiagnostics(params: {
  adAccountId: string; token: string; level: DiagLevel; since: string; until: string;
  campaignIds?: string[]; // si viene, solo trae lo de esas campañas (filtro en Meta)
}): Promise<{ dates: string[]; entities: DiagEntity[] }> {
  const { adAccountId, token, level, since, until, campaignIds } = params;
  const filtering = campaignIds && campaignIds.length
    ? JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }])
    : null;
  const dates = dateRange(since, until);
  const idxByDate: Record<string, number> = {};
  dates.forEach((d, i) => { idxByDate[d] = i; });

  const dailyUrl = new URL(`${BASE_URL}/${adAccountId}/insights`);
  dailyUrl.searchParams.set('level', level);
  dailyUrl.searchParams.set('fields', DAILY_FIELDS);
  dailyUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  dailyUrl.searchParams.set('time_increment', '1');
  dailyUrl.searchParams.set('limit', '500');
  dailyUrl.searchParams.set('access_token', token);
  if (filtering) dailyUrl.searchParams.set('filtering', filtering);

  const videoUrl = new URL(`${BASE_URL}/${adAccountId}/insights`);
  videoUrl.searchParams.set('level', level);
  videoUrl.searchParams.set('fields', VIDEO_FIELDS);
  videoUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  videoUrl.searchParams.set('time_increment', 'all_days');
  videoUrl.searchParams.set('limit', '500');
  videoUrl.searchParams.set('access_token', token);
  if (filtering) videoUrl.searchParams.set('filtering', filtering);

  const [dailyRows, videoRows] = await Promise.all([fetchAllPages(dailyUrl), fetchAllPages(videoUrl)]);

  const idKey = level === 'campaign' ? 'campaign_id' : level === 'adset' ? 'adset_id' : 'ad_id';
  const nameKey = level === 'campaign' ? 'campaign_name' : level === 'adset' ? 'adset_name' : 'ad_name';
  const empty = () => dates.map(() => null as number | null);

  const byId: Record<string, DiagEntity> = {};

  for (const row of dailyRows) {
    const id = row[idKey];
    if (!id) continue;
    if (!byId[id]) {
      byId[id] = {
        id,
        name: row[nameKey] || id,
        level,
        campaign_id: row.campaign_id || null,
        campaign_name: row.campaign_name || null,
        adset_id: level === 'campaign' ? null : row.adset_id || null,
        adset_name: level === 'campaign' ? null : row.adset_name || null,
        inicio: null,
        fin: null,
        totales: { gasto: 0, impresiones: 0, resultados: 0, clics_enlace: 0 },
        series: {
          impresiones: empty(), alcance: empty(), frecuencia: empty(), cpm: empty(), ctr: empty(),
          clics: empty(), clics_enlace: empty(), gasto: empty(), resultados: empty(), costo_resultado: empty(),
        },
        video: null,
      };
    }
    const e = byId[id];
    const i = idxByDate[row.date_start];
    if (i === undefined) continue;

    const spend = parseFloat(row.spend || '0');
    const impressions = parseInt(row.impressions || '0', 10);
    const reach = parseInt(row.reach || '0', 10);
    const { count, costPerResult } = extractResults(row.actions, row.conversions, row.cost_per_conversion, spend);

    e.series.impresiones[i] = impressions;
    e.series.alcance[i] = reach;
    e.series.frecuencia[i] = num(row.frequency) ?? (reach > 0 ? round(impressions / reach, 3) : null);
    e.series.cpm[i] = round(num(row.cpm) ?? (impressions > 0 ? (spend / impressions) * 1000 : null));
    e.series.ctr[i] = round(num(row.ctr), 3);
    e.series.clics[i] = parseInt(row.clicks || '0', 10);
    e.series.clics_enlace[i] = parseInt(row.inline_link_clicks || '0', 10);
    e.series.gasto[i] = round(spend);
    e.series.resultados[i] = count;
    e.series.costo_resultado[i] = count > 0 ? round(costPerResult) : null;

    e.totales.gasto += spend;
    e.totales.impresiones += impressions;
    e.totales.resultados += count;
    e.totales.clics_enlace += e.series.clics_enlace[i] || 0;
  }

  // Ventana activa real: primer y ultimo dia con impresiones > 0
  for (const e of Object.values(byId)) {
    const active = e.series.impresiones.map((v, i) => ((v || 0) > 0 ? i : -1)).filter((i) => i >= 0);
    if (active.length) {
      e.inicio = dates[active[0]];
      e.fin = dates[active[active.length - 1]];
    }
    e.totales.gasto = round(e.totales.gasto) || 0;
  }

  for (const row of videoRows) {
    const e = byId[row[idKey]];
    if (!e) continue;
    const plays = sumActions(row.video_play_actions);
    if (plays <= 0) continue;
    const pctOf = (arr: any[] | undefined) => round((sumActions(arr) / plays) * 100, 1);
    e.video = {
      reproducciones: plays,
      tiempo_prom: round(num(row.video_avg_time_watched_actions?.[0]?.value) || 0, 1) || 0,
      thruplays: sumActions(row.video_thruplay_watched_actions),
      r25: pctOf(row.video_p25_watched_actions),
      r50: pctOf(row.video_p50_watched_actions),
      r75: pctOf(row.video_p75_watched_actions),
      r100: pctOf(row.video_p100_watched_actions),
    };
  }

  const entities = Object.values(byId)
    .filter((e) => e.inicio) // solo lo que de verdad tuvo entrega en el rango
    .sort((a, b) => (a.campaign_name || '').localeCompare(b.campaign_name || '') || (a.adset_name || '').localeCompare(b.adset_name || '') || a.name.localeCompare(b.name));

  return { dates, entities };
}
