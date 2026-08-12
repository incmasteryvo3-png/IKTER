'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

type InsightRow = {
  level: 'campaign' | 'adset' | 'ad';
  level_id: string;
  level_name: string;
  campaign_id: string;
  adset_id: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  unique_link_clicks: number;
  post_engagement: number;
  video_plays: number;
  video_avg_watch_seconds: number;
  video_play_time_estimate: number;
  landing_page_views: number;
  results: number;
  cost_per_result: number | null;
  actions: { action_type: string; value: string }[];
  optimization_label?: string | null;
  status_label?: string | null;
  is_active?: boolean | null;
  start_time?: string | null;
  end_time?: string | null;
  landing_url?: string | null;
  landing_urls?: string[];
  objective_label?: string | null;
  buying_type_label?: string | null;
};

// Saca solo el path de una URL (sin dominio ni query params), para poder
// cruzar la landing page real del anuncio (Meta, URL completa con UTMs)
// contra el "landingPage" que devuelve GA4 (solo el path). Si la URL no
// se puede parsear, se devuelve tal cual para no romper nada.
function normalizePath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return path.toLowerCase();
  } catch {
    return url.split('?')[0].replace(/\/+$/, '').toLowerCase() || null;
  }
}

type Ga4Overview = {
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
type Ga4Channel = { channel: string; sessions: number; conversions: number; engagement_rate: number; new_users: number };
type Ga4Source = { source_medium: string; campaign: string; sessions: number; conversions: number; engagement_rate: number };
type Ga4LandingPage = { landing_page: string; sessions: number; conversions: number; bounce_rate: number; avg_session_duration: number };

// Canales que se resaltan en la tabla porque corresponden a trafico
// pago de redes sociales (Meta) - asi se ve de un vistazo si el trafico
// que Meta manda al sitio esta convirtiendo bien o no, sin salir del
// dashboard. Ojo: esto depende de que los anuncios lleven UTMs; ver
// nota en el README.
const META_CHANNEL_HINTS = ['paid social', 'social'];
function isMetaChannel(channel: string) {
  const c = channel.toLowerCase();
  return META_CHANNEL_HINTS.some((hint) => c.includes(hint));
}

const COLOR_CLASSES = ['c1', 'c2', 'c3'];

// Genera los anchos del embudo (trapecio que se va angostando) para
// cualquier cantidad de etapas, en vez de tener un arreglo fijo de 5
// numeros - asi un paquete de metricas puede tener 4, 5 o 6 etapas sin
// tener que tocar esta funcion.
function computeFunnelWidths(stageCount: number): number[] {
  const start = 100, end = 46;
  const step = (start - end) / stageCount;
  return Array.from({ length: stageCount + 1 }, (_, i) => start - i * step);
}

type Stage = {
  icon: string;
  label: string;
  desc: string;
  key: keyof InsightRow;
  // 'percent': tasa entre esta etapa y rateOf (como esta ahora en Resultados).
  // 'cost': costo (inversion / valor de esta etapa) - ej. CPC, costo por visita.
  // 'none': no se muestra nada al lado (primera etapa del embudo).
  rateMode: 'percent' | 'cost' | 'none';
  rateOf?: keyof InsightRow;
  rateDesc: string;
  // Si es true, junto al valor de Meta se muestra tambien el dato
  // cruzado de GA4 para esa misma etapa (solo aplica a "visitas a la
  // landing" - es la unica etapa que existe en ambas fuentes).
  showGa4?: boolean;
};

// ------------------------------------------------------------------
// Los 3 paquetes de metricas que se pueden elegir para ver el embudo de
// campañas y de conjuntos de anuncios. Pensados para necesidades
// distintas de venta consultiva - ver el porque de cada uno en el
// selector debajo (tooltip/descripcion corta).
// ------------------------------------------------------------------
const PACKAGES: Record<string, { name: string; short: string; description: string; stages: Stage[] }> = {
  inversion: {
    name: 'Inversión Real',
    short: 'Inversión Real',
    description: 'Lo esencial para decidir presupuesto: qué se gastó, quién de verdad hizo clic (no accidental), quién cargó la página, cuántos resultados y a qué costo.',
    stages: [
      { icon: '👥', label: 'ALCANCE', desc: 'Personas únicas', key: 'reach', rateMode: 'none', rateDesc: '' },
      { icon: '🖱', label: 'CLICS ÚNICOS', desc: 'En el enlace', key: 'unique_link_clicks', rateMode: 'cost', rateOf: 'unique_link_clicks', rateDesc: 'CPC (clic en enlace)' },
      { icon: '🌐', label: 'VISITAS', desc: 'A la landing', key: 'landing_page_views', rateMode: 'cost', rateOf: 'landing_page_views', rateDesc: 'Costo por visita', showGa4: true },
      { icon: '📋', label: 'RESULTADOS', desc: 'Conversión', key: 'results', rateMode: 'percent', rateOf: 'landing_page_views', rateDesc: 'Result. / Visitas' },
    ],
  },
  clasico: {
    name: 'Embudo Clásico Completo',
    short: 'Embudo Completo',
    description: 'El panorama de principio a fin, incluyendo impresiones y todos los clics (no solo los del enlace) - útil para ver el volumen total antes de que se filtre.',
    stages: [
      { icon: '👁', label: 'IMPRESIONES', desc: 'Veces mostrado', key: 'impressions', rateMode: 'none', rateDesc: '' },
      { icon: '👥', label: 'ALCANCE', desc: 'Personas únicas', key: 'reach', rateMode: 'percent', rateOf: 'impressions', rateDesc: 'Alcance / Impr.' },
      { icon: '🖱', label: 'CLICS (TODOS)', desc: 'Todo tipo de clic', key: 'clicks', rateMode: 'percent', rateOf: 'reach', rateDesc: 'CTR (todos)' },
      { icon: '🌐', label: 'VISITAS', desc: 'A la landing', key: 'landing_page_views', rateMode: 'percent', rateOf: 'clicks', rateDesc: 'Visitas / Clics', showGa4: true },
      { icon: '📋', label: 'RESULTADOS', desc: 'Conversión', key: 'results', rateMode: 'percent', rateOf: 'landing_page_views', rateDesc: 'Result. / Visitas' },
    ],
  },
  interaccion: {
    name: 'Calidad de Interacción',
    short: 'Calidad de Interacción',
    description: 'Para diagnosticar si el problema es el creativo (nadie interactúa) o la oferta (interactúan pero no llegan a la landing).',
    stages: [
      { icon: '👥', label: 'ALCANCE', desc: 'Personas únicas', key: 'reach', rateMode: 'none', rateDesc: '' },
      { icon: '🖱', label: 'CLICS (TODOS)', desc: 'Todo tipo de clic', key: 'clicks', rateMode: 'percent', rateOf: 'reach', rateDesc: 'CTR (todos)' },
      { icon: '💬', label: 'INTERACCIÓN', desc: 'Con la publicación', key: 'post_engagement', rateMode: 'percent', rateOf: 'clicks', rateDesc: 'Interac. / Clics' },
      { icon: '🌐', label: 'VISITAS', desc: 'A la landing', key: 'landing_page_views', rateMode: 'cost', rateOf: 'landing_page_views', rateDesc: 'Costo por visita', showGa4: true },
      { icon: '📋', label: 'RESULTADOS', desc: 'Conversión', key: 'results', rateMode: 'percent', rateOf: 'landing_page_views', rateDesc: 'Result. / Visitas' },
    ],
  },
};
type PackageKey = keyof typeof PACKAGES;

// Los 8 eventos de conversion que se muestran en la tabla de creativos.
// IMPORTANTE: los "types" son mi mejor suposicion de como se llaman estos
// eventos dentro del arreglo "actions" que devuelve Meta. Los estandar
// (page view, contenido visto, lead, etc.) deberian calzar. El que con
// mas seguridad hay que revisar es "Herramienta completada", porque suena
// a evento personalizado de Mastery, no a un evento estandar de Meta.
const EVENTS: { key: string; label: string; short: string; types: string[] }[] = [
  { key: 'page_view', label: 'Page view', short: 'P.view', types: ['landing_page_view', 'offsite_conversion.fb_pixel_page_view', 'omni_page_view'] },
  { key: 'view_content', label: 'Contenido visto', short: 'Cont.', types: ['view_content', 'offsite_conversion.fb_pixel_view_content', 'omni_view_content'] },
  { key: 'lead', label: 'Cliente potencial', short: 'Lead', types: ['lead', 'offsite_conversion.fb_pixel_lead', 'omni_lead'] },
  { key: 'subscribe', label: 'Suscripción', short: 'Susc.', types: ['subscribe', 'offsite_conversion.fb_pixel_subscribe', 'omni_subscribe'] },
  { key: 'tool_complete', label: 'Herramienta completada', short: 'Herr.', types: ['complete_tutorial', 'omni_complete_tutorial'] },
  { key: 'complete_registration', label: 'Formulario completado', short: 'Form.', types: ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration', 'omni_complete_registration'] },
  { key: 'schedule', label: 'Cita agendada', short: 'Cita', types: ['schedule', 'offsite_conversion.fb_pixel_schedule', 'omni_schedule'] },
  { key: 'submit_application', label: 'Solicitud enviada', short: 'Solic.', types: ['submit_application', 'offsite_conversion.fb_pixel_submit_application', 'omni_submit_application'] },
];

// Suma las sesiones de GA4 de VARIAS landing pages (cuando un conjunto o
// una campaña tiene anuncios que apuntan a destinos distintos, hay que
// unificar/sumar en vez de quedarse con una sola). Si ninguna de las
// landings aparece en GA4 para el rango, devuelve null (no 0) para que
// el frontend sepa que no hay dato, no que el dato es cero.
function aggregateGa4Sessions(urls: string[] | undefined, ga4Map: Record<string, number>): number | null {
  if (!urls || urls.length === 0) return null;
  const paths = new Set(urls.map(normalizePath).filter((p): p is string => Boolean(p)));
  if (paths.size === 0) return null;
  let total = 0, found = false;
  for (const p of paths) {
    if (p in ga4Map) { total += ga4Map[p]; found = true; }
  }
  return found ? total : null;
}
function fmt(n: number) {
  return n.toLocaleString('es-CO');
}
function pct(part: number, whole: number) {
  return whole ? `${((part / whole) * 100).toFixed(2).replace('.', ',')}%` : '—';
}
function costPer(spend: number, count: number) {
  return count > 0 ? `$${(spend / count).toFixed(2)}` : '—';
}
function clipPath(topPct: number, bottomPct: number) {
  const it = (100 - topPct) / 2, ib = (100 - bottomPct) / 2;
  return `polygon(${it}% 0, calc(100% - ${it}%) 0, calc(100% - ${ib}%) 100%, ${ib}% 100%)`;
}
function todayISO(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}
function shortDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function getEventCount(row: InsightRow, types: string[]): number {
  if (!row.actions) return 0;
  return row.actions.filter((a) => types.includes(a.action_type)).reduce((s, a) => s + parseInt(a.value || '0', 10), 0);
}
// Nota: antes habia aqui una funcion "getDominantEvent" que adivinaba el
// evento de conversion contando cuales acciones tuvieron mas ocurrencias.
// Se elimino porque podia mostrar un evento equivocado (el que mas
// disparo, no el que realmente se configuro como objetivo). Ahora el
// conjunto de anuncios trae su "optimization_label" real desde Meta
// (ver lib/meta.ts -> fetchAdsetGoals), que es la fuente de verdad.

type FunnelItem = {
  id: string;
  name: string;
  cls: string;
  data: InsightRow;
  badge?: string | null;
  landingUrl?: string | null;
  ga4Sessions?: number | null;
};

export default function Dashboard() {
  const router = useRouter();
  const [since, setSince] = useState(todayISO(-30));
  const [until, setUntil] = useState(todayISO());
  const [nCampaigns, setNCampaigns] = useState(2);
  const [campaigns, setCampaigns] = useState<InsightRow[]>([]);
  const [adsets, setAdsets] = useState<InsightRow[]>([]);
  const [ads, setAds] = useState<InsightRow[]>([]);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [metricPackage, setMetricPackage] = useState<PackageKey>('inversion');

  const [ga4Overview, setGa4Overview] = useState<Ga4Overview | null>(null);
  const [ga4Channels, setGa4Channels] = useState<Ga4Channel[]>([]);
  const [ga4Sources, setGa4Sources] = useState<Ga4Source[]>([]);
  const [ga4LandingPages, setGa4LandingPages] = useState<Ga4LandingPage[]>([]);
  const [ga4Loading, setGa4Loading] = useState(true);
  const [ga4Error, setGa4Error] = useState<string | null>(null);

  const loadInsights = useCallback(async (s: string, u: string) => {
    setQuerying(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights?since=${s}&until=${u}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al consultar Meta.');
      setCampaigns(json.campaigns || []);
      setAdsets(json.adsets || []);
      setAds(json.ads || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setQuerying(false);
      setLoading(false);
    }
  }, []);

  // Independiente de loadInsights a proposito: si GA4 todavia no esta
  // configurado (o la consulta falla), el resto del dashboard (Meta)
  // sigue funcionando normal - un error aca no bloquea nada mas.
  const loadGa4 = useCallback(async (s: string, u: string) => {
    setGa4Loading(true);
    setGa4Error(null);
    try {
      const res = await fetch(`/api/insights/ga4?since=${s}&until=${u}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al consultar GA4.');
      setGa4Overview(json.overview || null);
      setGa4Channels(json.channels || []);
      setGa4Sources(json.sources || []);
      setGa4LandingPages(json.landing_pages || []);
    } catch (e: any) {
      setGa4Error(e.message);
    } finally {
      setGa4Loading(false);
    }
  }, []);

  useEffect(() => {
    loadInsights(since, until);
    loadGa4(since, until);
    supabaseBrowser
      .from('insight_snapshots')
      .select('fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (data && data.length > 0) setLastFetched(data[0].fetched_at); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mantiene selIds siempre con exactamente nCampaigns elementos validos.
  // Se corrigio aqui el bug anterior: antes esta logica vivia mezclada
  // dentro de loadInsights y una carga en curso podia sobrescribir la
  // eleccion del usuario con un numero viejo de campañas. Ahora es un
  // efecto independiente, sin condiciones de carrera.
  useEffect(() => {
    setSelIds((prev) => {
      const ids = campaigns.map((c) => c.level_id);
      if (ids.length === 0) return prev;
      const next = prev.filter((id) => ids.includes(id));
      while (next.length < nCampaigns) {
        const candidate = ids.find((id) => !next.includes(id));
        if (!candidate) break;
        next.push(candidate);
      }
      return next.slice(0, nCampaigns);
    });
  }, [nCampaigns, campaigns]);

  async function handleLogout() {
    await supabaseBrowser.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al sincronizar con Meta');
      setLastFetched(json.synced_at);
      await Promise.all([loadInsights(since, until), loadGa4(since, until)]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    try {
      const [{ default: html2canvas }, jsPDFModule] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const JsPDF = jsPDFModule.default;
      const target = document.querySelector('.wrap') as HTMLElement;
      const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const pdf = new JsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save('reporte-mastery-campanas.pdf');
    } catch (e: any) {
      setError('No se pudo generar el PDF: ' + e.message);
    } finally {
      setDownloadingPdf(false);
    }
  }

  const ga4SessionsByPath = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of ga4LandingPages) {
      const key = normalizePath(p.landing_page);
      if (key) map[key] = (map[key] || 0) + p.sessions;
    }
    return map;
  }, [ga4LandingPages]);

  const selectedCampaigns: FunnelItem[] = useMemo(
    () => selIds.map((id, i) => {
      const data = campaigns.find((c) => c.level_id === id);
      if (!data) return null;
      return {
        id, name: data.level_name, cls: COLOR_CLASSES[i % 3], data,
        landingUrl: data.landing_url || null,
        ga4Sessions: aggregateGa4Sessions(data.landing_urls, ga4SessionsByPath),
      };
    }).filter(Boolean) as FunnelItem[],
    [selIds, campaigns, ga4SessionsByPath]
  );

  // Anuncios que pertenecen a alguna de las campañas seleccionadas,
  // con su conjunto de anuncios resuelto (para agrupar la tabla).
  const orderedAdsets = useMemo(() => {
    const selectedCampaignIds = new Set(selectedCampaigns.map((s) => s.data.level_id));
    return adsets
      .filter((a) => selectedCampaignIds.has(a.campaign_id))
      .map((a) => ({
        id: a.level_id,
        name: a.level_name,
        dominant: a.optimization_label || null,
        statusLabel: a.status_label || null,
        isActive: a.is_active ?? null,
        startTime: a.start_time || null,
        endTime: a.end_time || null,
      }));
  }, [adsets, selectedCampaigns]);

  const filteredAds = useMemo(() => {
    const validAdsetIds = new Set(orderedAdsets.map((a) => a.id));
    return ads
      .filter((a) => validAdsetIds.has(a.adset_id))
      .map((a) => ({ ...a, adsetId: a.adset_id }));
  }, [ads, orderedAdsets]);

  const badges = useMemo(() => {
    if (filteredAds.length === 0) return null;
    const maxReach = filteredAds.reduce((m, a) => (a.reach > m.reach ? a : m), filteredAds[0]);
    const maxPlays = filteredAds.reduce((m, a) => (a.video_plays > m.video_plays ? a : m), filteredAds[0]);
    const maxAvg = filteredAds.reduce((m, a) => (a.video_avg_watch_seconds > m.video_avg_watch_seconds ? a : m), filteredAds[0]);
    const maxPlaytime = filteredAds.reduce((m, a) => (a.video_play_time_estimate > m.video_play_time_estimate ? a : m), filteredAds[0]);
    const weakest = filteredAds.reduce((m, a) => {
      const scoreA = (maxReach.reach ? a.reach / maxReach.reach : 0) + (maxPlays.video_plays ? a.video_plays / maxPlays.video_plays : 0);
      const scoreM = (maxReach.reach ? m.reach / maxReach.reach : 0) + (maxPlays.video_plays ? m.video_plays / maxPlays.video_plays : 0);
      return scoreA < scoreM ? a : m;
    }, filteredAds[0]);
    return { maxReach, maxPlays, maxAvg, maxPlaytime, weakest };
  }, [filteredAds]);

  return (
    <div className="wrap">
      <div className="header">
        <img className="logo" src="/logo-mastery.png" alt="Mastery" />
        <h1 className="title">Reporte de campañas</h1>
        <p className="period">
          Datos en vivo desde Meta Ads
          {lastFetched && ` · Último sync guardado: ${new Date(lastFetched).toLocaleString('es-CO')}`}
        </p>
        <div className="actions">
          <button className="btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Actualizando…' : 'Actualizar ahora'}
          </button>
          <button className="btn ghost" onClick={handleDownloadPdf} disabled={downloadingPdf}>
            {downloadingPdf ? 'Generando PDF…' : '⬇ Descargar informe (PDF)'}
          </button>
          <button className="btn" onClick={handleLogout}>Cerrar sesión</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <Ga4Section
        loading={ga4Loading}
        error={ga4Error}
        overview={ga4Overview}
        channels={ga4Channels}
        sources={ga4Sources}
        landingPages={ga4LandingPages}
        since={since}
        until={until}
      />

      <div className="section-title big">Meta Ads</div>

      <div className="controls-panel">
        <div className="control-group">
          <label>Fecha inicial</label>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </div>
        <div className="control-group">
          <label>Fecha final</label>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
        <div className="control-group">
          <label>Campañas a comparar</label>
          <div className="segmented">
            {[1, 2, 3].map((n) => (
              <button key={n} className={nCampaigns === n ? 'active' : ''} onClick={() => setNCampaigns(n)}>{n}</button>
            ))}
          </div>
        </div>
        <button
          className="btn primary"
          style={{ height: 37 }}
          onClick={() => { loadInsights(since, until); loadGa4(since, until); }}
          disabled={querying}
        >
          {querying ? 'Consultando…' : 'Consultar'}
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Cargando datos…</div>
      ) : campaigns.length === 0 ? (
        <div className="empty-state">No hay campañas con datos en este rango de fechas.</div>
      ) : (
        <>
          <div className="select-row">
            {selIds.map((id, i) => (
              <select key={i} value={id} onChange={(e) => setSelIds((prev) => prev.map((v, idx) => idx === i ? e.target.value : v))}>
                {campaigns.map((c) => <option key={c.level_id} value={c.level_id}>{c.level_name}</option>)}
              </select>
            ))}
          </div>

          <MetricPackageSelector value={metricPackage} onChange={setMetricPackage} />

          <FunnelGroup items={selectedCampaigns} stages={PACKAGES[metricPackage].stages} />

          <AiCardPair payload={{ tipo: 'comparación de campañas', periodo: { since, until }, campañas: selectedCampaigns.map((s) => s.data) }} />

          {selectedCampaigns.map((camp) => {
            const campAdsets: FunnelItem[] = adsets
              .filter((a) => a.campaign_id === camp.data.level_id)
              .map((a, i) => ({
                id: a.level_id,
                name: a.level_name,
                cls: COLOR_CLASSES[i % 3],
                data: a,
                badge: a.optimization_label || null,
                landingUrl: a.landing_url || null,
                ga4Sessions: aggregateGa4Sessions(a.landing_urls, ga4SessionsByPath),
              }));

            return (
              <div key={camp.id}>
                <div className="section-title big">Conjuntos de anuncios — {camp.name}</div>
                {campAdsets.length === 0 ? (
                  <div className="empty-state">Esta campaña no tiene conjuntos de anuncios con actividad en el rango seleccionado.</div>
                ) : (
                  <>
                    <FunnelGroup items={campAdsets} stages={PACKAGES[metricPackage].stages} />
                    {campAdsets.map((adset) => (
                      <div key={adset.id} style={{ marginTop: 18 }}>
                        <div className="section-sub" style={{ fontWeight: 600, color: 'var(--carbon)' }}>Análisis — {adset.name}</div>
                        <AiCardPair payload={{ tipo: 'conjunto de anuncios', campaña: camp.name, periodo: { since, until }, conjunto: adset.data }} />
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}

          {badges && (
            <>
              <div className="section-title big">Creativos</div>
              <p className="section-sub">Insignias y eventos de conversión de los anuncios en las campañas seleccionadas.</p>
              <div className="badge-row">
                <Badge label="MAYOR ALCANCE" name={badges.maxReach.level_name} value={fmt(badges.maxReach.reach)} />
                <Badge label="MÁS REPRODUCCIONES" name={badges.maxPlays.level_name} value={fmt(badges.maxPlays.video_plays)} />
                <Badge label="MEJOR TIEMPO PROMEDIO" name={badges.maxAvg.level_name} value={`${badges.maxAvg.video_avg_watch_seconds.toFixed(0)}s`} />
                <Badge label="MAYOR TIEMPO DE REPRODUCCIÓN" name={badges.maxPlaytime.level_name} value={fmt(badges.maxPlaytime.video_play_time_estimate)} />
              </div>

              <div className="results-table-wrap">
                <ResultsTable ads={filteredAds} badges={badges} orderedAdsets={orderedAdsets} ga4SessionsByPath={ga4SessionsByPath} />
              </div>

              <AiCardPair payload={{ tipo: 'tabla de creativos', periodo: { since, until }, anuncios: filteredAds }} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// Para la etapa VISITAS: si hay un dato de GA4 cruzado (misma landing
// page), se muestran los dos valores lado a lado con su plataforma
// identificada. Si no hay cruce (falta el link de la landing, o esa
// landing no aparece en GA4 para el rango), se ve igual que antes -
// solo el valor de Meta, sin dejar un hueco raro en la interfaz.
function VisitsLabel({ metaValue, ga4Value }: { metaValue: number; ga4Value?: number | null }) {
  if (ga4Value == null) return <div className="bar-label">{fmt(metaValue)}</div>;
  return (
    <div className="bar-label multi">
      <span className="platform-value"><span className="platform-tag meta">Meta</span>{fmt(metaValue)}</span>
      <span className="platform-value"><span className="platform-tag ga4">GA4</span>{fmt(ga4Value)}</span>
    </div>
  );
}

function Badge({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <div className="badge">
      <div className="badge-label">{label}</div>
      <div className="badge-winner">{name}</div>
      <div className="badge-value">{value}</div>
    </div>
  );
}

// Calcula lo que va en la columna de "tasa" (al otro lado de la barra):
// un porcentaje (ej. "Result. / Visitas"), un costo (ej. "CPC"), o nada.
function RateCell({ stage, data }: { stage: Stage; data: InsightRow }) {
  if (stage.rateMode === 'none' || !stage.rateOf) return null;
  const value = stage.rateMode === 'cost'
    ? costPer(data.spend, data[stage.rateOf] as number)
    : pct(data[stage.key] as number, data[stage.rateOf] as number);
  if (value === '—') return null;
  return <><div className="rate-value">{value}</div><div className="rate-desc">{stage.rateDesc}</div></>;
}

function BarLabel({ stage, item }: { stage: Stage; item: FunnelItem }) {
  if (stage.showGa4) return <VisitsLabel metaValue={item.data[stage.key] as number} ga4Value={item.ga4Sessions} />;
  return <div className="bar-label">{fmt(item.data[stage.key] as number)}</div>;
}

// Renderiza un grupo de embudos (campañas o conjuntos de anuncios):
// version escritorio (barras lado a lado en un solo panel) y version
// celular (un embudo completo por item, apilados) - la que se muestra
// depende del ancho de pantalla via CSS, no de JS. "stages" define QUE
// metricas se ven (el paquete elegido en el selector), asi este mismo
// componente sirve para los 3 paquetes sin duplicar codigo.
function FunnelGroup({ items, stages }: { items: FunnelItem[]; stages: Stage[] }) {
  if (items.length === 0) return null;
  const gridStyle = { gridTemplateColumns: `repeat(${items.length}, 1fr)` };
  const best = items.reduce((m, s) => (s.data.results > m.data.results ? s : m), items[0]);
  const widths = computeFunnelWidths(stages.length);
  const lastWidth = widths[widths.length - 1];
  const flatCp = clipPath(lastWidth, lastWidth);

  return (
    <>
      <div className="funnel-panel desktop-only">
        <div className="accounts-row" style={gridStyle}>
          {items.map((s) => <AccountBox key={s.id} item={s} />)}
        </div>
        {stages.map((st, i) => {
          const cp = clipPath(widths[i], widths[i + 1]);
          const ref = items[0]?.data;
          return (
            <div className="funnel-row" key={st.label}>
              <div className="funnel-icon-col"><div className="icon-circle">{st.icon}</div><div><div className="row-label">{st.label}</div><div className="row-desc">{st.desc}</div></div></div>
              <div className="funnel-bars">
                {items.map((s) => (
                  <div className="bar-wrap" key={s.id}>
                    <div className={`bar-shape ${s.cls}`} style={{ clipPath: cp }} />
                    <BarLabel stage={st} item={s} />
                  </div>
                ))}
              </div>
              <div className="funnel-rate">{ref && <RateCell stage={st} data={ref} />}</div>
            </div>
          );
        })}
        <div className="funnel-row">
          <div className="funnel-icon-col"><div className="icon-circle">$</div><div><div className="row-label">COSTO / RESULTADO</div><div className="row-desc">Por conversión</div></div></div>
          <div className="funnel-bars">
            {items.map((s) => {
              const cpr = s.data.cost_per_result ? `$${s.data.cost_per_result.toFixed(2)}` : 'SIN CONVERSIONES';
              return (
                <div className="bar-wrap" key={s.id}>
                  <div className={`bar-shape ${s.cls}`} style={{ clipPath: flatCp, opacity: s.data.results === 0 ? 0.55 : 1 }} />
                  <div className={`bar-label ${s.data.results === 0 ? 'dim' : ''}`}>{cpr}</div>
                </div>
              );
            })}
          </div>
          <div className="funnel-rate" />
        </div>
      </div>

      <div className="funnels-grid mobile-only" style={gridStyle}>
        {items.map((s) => (
          <div className="funnel-single" key={s.id}>
            <AccountBox item={s} />
            {stages.map((st, i) => {
              const cp = clipPath(widths[i], widths[i + 1]);
              return (
                <div className="funnel-row" key={st.label}>
                  <div className="funnel-icon-col"><div className="icon-circle">{st.icon}</div><div><div className="row-label">{st.label}</div><div className="row-desc">{st.desc}</div></div></div>
                  <div className="bar-wrap">
                    <div className={`bar-shape ${s.cls}`} style={{ clipPath: cp }} />
                    <BarLabel stage={st} item={s} />
                  </div>
                  <div className="funnel-rate"><RateCell stage={st} data={s.data} /></div>
                </div>
              );
            })}
            <div className="funnel-row">
              <div className="funnel-icon-col"><div className="icon-circle">$</div><div><div className="row-label">COSTO / RESULT.</div><div className="row-desc">Por conversión</div></div></div>
              <div className="bar-wrap">
                <div className={`bar-shape ${s.cls}`} style={{ clipPath: flatCp, opacity: s.data.results === 0 ? 0.55 : 1 }} />
                <div className={`bar-label ${s.data.results === 0 ? 'dim' : ''}`}>{s.data.cost_per_result ? `$${s.data.cost_per_result.toFixed(2)}` : 'SIN CONVERSIONES'}</div>
              </div>
              <div className="funnel-rate" />
            </div>
          </div>
        ))}
      </div>

      <div className="summary-grid" style={gridStyle}>
        {items.map((s) => (
          <div className={`summary-col ${s.cls}`} key={s.id}>
            <h4>RESUMEN {s.name}</h4>
            <ul>
              <li><span className="check">✔</span>{s.data.results} resultado{s.data.results !== 1 ? 's' : ''} generado{s.data.results !== 1 ? 's' : ''}</li>
              <li><span className="check">✔</span>{s.data.cost_per_result ? `Costo por resultado: $${s.data.cost_per_result.toFixed(2)}` : 'Sin costo por resultado (sin conversiones)'}</li>
              <li><span className="check">✔</span>{s.data.landing_page_views} visitas a la landing page (Meta){s.ga4Sessions != null ? ` · ${s.ga4Sessions} según GA4` : ''}</li>
            </ul>
          </div>
        ))}
      </div>

      {items.length > 1 && (
        <div className="insight-bar">
          <span className="bulb">💡</span>
          <span>{best.name} lidera con {best.data.results} resultado(s) en el período seleccionado. Revisa la creatividad y el paso de conversión de los más débiles antes de escalar inversión.</span>
        </div>
      )}
    </>
  );
}

// Selector de paquete de metricas - reutilizable para el embudo de
// campañas y el de conjuntos de anuncios (comparten la misma seleccion,
// para poder comparar peras con peras entre ambos niveles).
function MetricPackageSelector({ value, onChange }: { value: PackageKey; onChange: (v: PackageKey) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="segmented">
        {(Object.keys(PACKAGES) as PackageKey[]).map((key) => (
          <button key={key} className={value === key ? 'active' : ''} onClick={() => onChange(key)} title={PACKAGES[key].description}>
            {PACKAGES[key].short}
          </button>
        ))}
      </div>
      <p className="section-sub" style={{ marginTop: 6, marginBottom: 0 }}>{PACKAGES[value].description}</p>
    </div>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const full = `${u.hostname.replace(/^www\./, '')}${path}`;
    return full.length > 42 ? `${full.slice(0, 39)}…` : full;
  } catch {
    return url.length > 42 ? `${url.slice(0, 39)}…` : url;
  }
}

function AccountBox({ item }: { item: FunnelItem }) {
  const d = item.data;
  const hasStatus = d.status_label != null;
  const from = shortDate(d.start_time);
  const to = shortDate(d.end_time);
  const isCampaign = d.level === 'campaign';
  return (
    <div className={`account-box ${item.cls}`}>
      <div className="account-logo">M</div>
      <div>
        <div className="account-name">
          {item.name}
          {hasStatus && (
            <span className={`status-pill ${d.is_active ? 'is-active' : 'is-inactive'}`}>
              {d.is_active ? '● Activo' : `○ ${d.status_label}`}
            </span>
          )}
        </div>
        <div className="account-label">INVERSIÓN TOTAL &nbsp; <span className="account-spend">${d.spend.toFixed(2)}</span></div>
        <div className="account-meta-row">
          {isCampaign && d.objective_label && <div className="account-event">Objetivo: {d.objective_label}</div>}
          {isCampaign && d.buying_type_label && <div className="account-event">Tipo de compra: {d.buying_type_label}</div>}
          {item.badge && <div className="account-event">Evento de conversión: {item.badge}</div>}
          {item.landingUrl && (
            <a className="account-event account-link" href={item.landingUrl} target="_blank" rel="noopener noreferrer" title={item.landingUrl}>
              🔗 {shortUrl(item.landingUrl)}{d.landing_urls && d.landing_urls.length > 1 ? ` (+${d.landing_urls.length - 1})` : ''}
            </a>
          )}
        </div>
        {from && <div className="account-event">Período activo: {from}{to ? ` – ${to}` : ' – en curso'}</div>}
      </div>
    </div>
  );
}

// Par de tarjetas de analisis (Gemini + Claude). Cada una se genera bajo
// demanda con su propio boton, para no gastar cuota de las APIs de IA
// automaticamente en cada carga de pagina.
function AiCardPair({ payload }: { payload: unknown }) {
  return (
    <div className="ai-cards-row">
      <AiCard provider="gemini" title="Gemini" payload={payload} />
      <AiCard provider="claude" title="Claude" payload={payload} />
    </div>
  );
}

function AiCard({ provider, title, payload }: { provider: 'gemini' | 'claude'; title: string; payload: unknown }) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/analyze/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al generar el análisis');
      setSummary(json.summary_md);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai-card">
      <div className="ai-card-header">
        <div className={`ai-card-title ${provider}`}>{provider === 'gemini' ? '✨' : '◆'} {title}</div>
        <button className="btn small" onClick={generate} disabled={loading}>{loading ? 'Analizando…' : summary ? 'Actualizar' : 'Generar análisis'}</button>
      </div>
      {err && <div className="error-banner" style={{ marginBottom: 0 }}>{err}</div>}
      {summary ? (
        <div className="ai-card-body" dangerouslySetInnerHTML={{ __html: mdToHtml(summary) }} />
      ) : !loading && !err ? (
        <div className="ai-card-empty">Presiona "Generar análisis" para que {title} analice estos datos.</div>
      ) : null}
    </div>
  );
}

type AdRow = InsightRow & { adsetId: string };
type AdsetGroup = {
  id: string;
  name: string;
  dominant: string | null;
  statusLabel: string | null;
  isActive: boolean | null;
  startTime: string | null;
  endTime: string | null;
};

function ResultsTable({ ads, badges, orderedAdsets, ga4SessionsByPath }: { ads: AdRow[]; badges: any; orderedAdsets: AdsetGroup[]; ga4SessionsByPath: Record<string, number> }) {
  function Cell({ value, isBest, isWeak, format }: { value: number; isBest: boolean; isWeak: boolean; format: (v: number) => string }) {
    return <td className={isBest ? 'best-cell' : isWeak ? 'weak-cell' : ''}>{format(value)}</td>;
  }

  const colCount = 7 + EVENTS.length; // Anuncio + Alcance + Reprod. + T.prom + T.rep + Visitas + eventos

  return (
    <table className="results-table">
      <thead>
        <tr>
          <th>Anuncio</th>
          <th>Alc.</th>
          <th>Reprod.</th>
          <th>T.prom</th>
          <th>T.rep</th>
          <th title="Visitas a la landing: Meta / GA4">Visitas (Meta/GA4)</th>
          {EVENTS.map((ev) => <th key={ev.key} title={ev.label}>{ev.short}</th>)}
        </tr>
      </thead>
      <tbody>
        {orderedAdsets.map((as) => {
          const groupAds = ads.filter((a) => a.adsetId === as.id);
          if (groupAds.length === 0) return null;
          const from = shortDate(as.startTime);
          const to = shortDate(as.endTime);
          return (
            <>
              <tr className="adset-group-row" key={`group-${as.id}`}>
                <td colSpan={colCount}>
                  {as.name}
                  {as.statusLabel && (
                    <span className={`status-pill ${as.isActive ? 'is-active' : 'is-inactive'}`}>
                      {as.isActive ? '● Activo' : `○ ${as.statusLabel}`}
                    </span>
                  )}
                  {' — '}
                  {as.dominant ? <>Conversión: <span className="conv">{as.dominant}</span></> : <span className="conv">Sin conversiones en el período</span>}
                  {from && <span className="group-dates"> · Período: {from}{to ? ` – ${to}` : ' – en curso'}</span>}
                </td>
              </tr>
              {groupAds.map((a) => {
                const isWeakest = a === badges.weakest;
                const isTopOverall = a === badges.maxReach && a === badges.maxPlaytime;
                const path = normalizePath(a.landing_url);
                const ga4Value = path && path in ga4SessionsByPath ? ga4SessionsByPath[path] : null;
                return (
                  <tr key={a.level_id} className={isTopOverall ? 'best-row' : ''}>
                    <td>
                      <div className="ad-name-cell" title={a.level_name}>
                        {(a === badges.maxReach || a === badges.maxPlaytime) && <span className="crown">★</span>}
                        {isWeakest && <span className="warn">⚠</span>}
                        {a.level_name}
                      </div>
                    </td>
                    <Cell value={a.reach} isBest={a === badges.maxReach} isWeak={isWeakest} format={fmt} />
                    <Cell value={a.video_plays} isBest={a === badges.maxPlays} isWeak={isWeakest} format={fmt} />
                    <Cell value={a.video_avg_watch_seconds} isBest={a === badges.maxAvg} isWeak={isWeakest} format={(v) => `${v.toFixed(0)}s`} />
                    <Cell value={a.video_play_time_estimate} isBest={a === badges.maxPlaytime} isWeak={isWeakest} format={fmt} />
                    <td className={a.landing_page_views === 0 ? 'weak-cell' : ''} title={a.landing_url || undefined}>
                      {fmt(a.landing_page_views)}{ga4Value != null ? ` / ${fmt(ga4Value)}` : ''}
                    </td>
                    {EVENTS.map((ev) => {
                      const count = getEventCount(a, ev.types);
                      return <td key={ev.key} className={count === 0 ? 'weak-cell' : ''}>{count}</td>;
                    })}
                  </tr>
                );
              })}
            </>
          );
        })}
      </tbody>
    </table>
  );
}

function pctFromRate(rate: number) {
  return `${(rate * 100).toFixed(1).replace('.', ',')}%`;
}
function fmtSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function Ga4Section({
  loading, error, overview, channels, sources, landingPages, since, until,
}: {
  loading: boolean;
  error: string | null;
  overview: Ga4Overview | null;
  channels: Ga4Channel[];
  sources: Ga4Source[];
  landingPages: Ga4LandingPage[];
  since: string;
  until: string;
}) {
  return (
    <div>
      <div className="section-title big">Desempeño del sitio web — Google Analytics 4</div>
      <p className="section-sub">Sesiones, conversiones y canales de tráfico del rango de fechas seleccionado arriba.</p>

      {error && (
        <div className="error-banner">
          No se pudo consultar GA4: {error}
          {error.includes('GA4_') && ' — revisa las variables de entorno GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_EMAIL y GA4_SERVICE_ACCOUNT_PRIVATE_KEY.'}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Cargando datos de GA4…</div>
      ) : !overview ? (
        !error ? <div className="empty-state">No hay datos de GA4 para este rango de fechas.</div> : null
      ) : (
        <>
          <div className="badge-row">
            <Badge label="SESIONES" name="Total del período" value={fmt(overview.sessions)} />
            <Badge label="USUARIOS" name={`${fmt(overview.new_users)} nuevos`} value={fmt(overview.total_users)} />
            <Badge label="TASA DE INTERACCIÓN" name={`${fmt(overview.engaged_sessions)} sesiones interactivas`} value={pctFromRate(overview.engagement_rate)} />
            <Badge label="DURACIÓN PROMEDIO" name="Por sesión" value={fmtSeconds(overview.avg_session_duration)} />
            <Badge label="CONVERSIONES" name={`${fmt(overview.event_count)} eventos totales`} value={fmt(overview.conversions)} />
          </div>

          {channels.length > 0 && (
            <div className="results-table-wrap" style={{ marginBottom: 16 }}>
              <table className="results-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Canal</th>
                    <th>Sesiones</th>
                    <th>Usuarios nuevos</th>
                    <th>Conversiones</th>
                    <th>Interacción</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.channel} className={isMetaChannel(c.channel) ? 'best-row' : ''}>
                      <td className="ad-name-cell" title={c.channel}>
                        {isMetaChannel(c.channel) && <span className="crown">★</span>}
                        {c.channel}
                      </td>
                      <td>{fmt(c.sessions)}</td>
                      <td>{fmt(c.new_users)}</td>
                      <td className={c.conversions === 0 ? 'weak-cell' : ''}>{fmt(c.conversions)}</td>
                      <td>{pctFromRate(c.engagement_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sources.filter((s) => isMetaChannel(s.source_medium) || s.source_medium.toLowerCase().includes('facebook') || s.source_medium.toLowerCase().includes('instagram') || s.source_medium.toLowerCase().includes('meta')).length > 0 && (
            <>
              <div className="section-title">Tráfico proveniente de Meta (por UTM)</div>
              <div className="results-table-wrap" style={{ marginBottom: 16 }}>
                <table className="results-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Origen / medio</th>
                      <th style={{ textAlign: 'left' }}>Campaña</th>
                      <th>Sesiones</th>
                      <th>Conversiones</th>
                      <th>Interacción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources
                      .filter((s) => isMetaChannel(s.source_medium) || s.source_medium.toLowerCase().includes('facebook') || s.source_medium.toLowerCase().includes('instagram') || s.source_medium.toLowerCase().includes('meta'))
                      .map((s, i) => (
                        <tr key={`${s.source_medium}-${s.campaign}-${i}`}>
                          <td className="ad-name-cell" title={s.source_medium}>{s.source_medium}</td>
                          <td className="ad-name-cell" title={s.campaign}>{s.campaign}</td>
                          <td>{fmt(s.sessions)}</td>
                          <td className={s.conversions === 0 ? 'weak-cell' : ''}>{fmt(s.conversions)}</td>
                          <td>{pctFromRate(s.engagement_rate)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {landingPages.length > 0 && (
            <>
              <div className="section-title">Páginas de destino con más tráfico</div>
              <div className="results-table-wrap" style={{ marginBottom: 16 }}>
                <table className="results-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Página</th>
                      <th>Sesiones</th>
                      <th>Conversiones</th>
                      <th>Rebote</th>
                      <th>Duración prom.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {landingPages.map((p) => (
                      <tr key={p.landing_page}>
                        <td className="ad-name-cell" title={p.landing_page} style={{ maxWidth: 260 }}>{p.landing_page}</td>
                        <td>{fmt(p.sessions)}</td>
                        <td className={p.conversions === 0 ? 'weak-cell' : ''}>{fmt(p.conversions)}</td>
                        <td>{pctFromRate(p.bounce_rate)}</td>
                        <td>{fmtSeconds(p.avg_session_duration)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <AiCardPair
            payload={{
              tipo: 'desempeño del sitio web (GA4)',
              periodo: { since, until },
              resumen: overview,
              canales: channels,
              origenes_meta: sources.filter((s) => isMetaChannel(s.source_medium)),
              paginas_de_destino: landingPages,
            }}
          />
        </>
      )}
    </div>
  );
}

function mdToHtml(md: string) {
  return md
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^- (.*)$/gm, '&nbsp;&nbsp;• $1<br/>')
    .replace(/\n\n/g, '<br/>');
}
