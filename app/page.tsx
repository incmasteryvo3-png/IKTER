'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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
  video_plays: number;
  video_avg_watch_seconds: number;
  video_play_time_estimate: number;
  landing_page_views: number;
  results: number;
  cost_per_result: number | null;
  actions: { action_type: string; value: string }[];
};

const COLOR_CLASSES = ['c1', 'c2', 'c3'];
const FUNNEL_WIDTHS = [100, 88, 76, 64, 52];
const STAGES = [
  { icon: '👁', label: 'IMPRESIONES', desc: 'Veces mostrado', key: 'impressions' as const, rateOf: null as null | keyof InsightRow, rateDesc: '' },
  { icon: '👥', label: 'ALCANCE', desc: 'Personas únicas', key: 'reach' as const, rateOf: 'impressions' as keyof InsightRow, rateDesc: 'Alcance / Impr.' },
  { icon: '🖱', label: 'CLICS', desc: 'Clic en enlace', key: 'link_clicks' as const, rateOf: 'reach' as keyof InsightRow, rateDesc: 'Clics / Alcance' },
  { icon: '🌐', label: 'VISITAS', desc: 'A la landing', key: 'landing_page_views' as const, rateOf: 'link_clicks' as keyof InsightRow, rateDesc: 'Visitas / Clics' },
  { icon: '📋', label: 'RESULTADOS', desc: 'Conversión', key: 'results' as const, rateOf: 'landing_page_views' as keyof InsightRow, rateDesc: 'Result. / Visitas' },
];

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

function pct(part: number, whole: number) {
  return whole ? `${((part / whole) * 100).toFixed(2).replace('.', ',')}%` : '—';
}
function fmt(n: number) {
  return n.toLocaleString('es-CO');
}
function clipPath(topPct: number, bottomPct: number) {
  const it = (100 - topPct) / 2, ib = (100 - bottomPct) / 2;
  return `polygon(${it}% 0, calc(100% - ${it}%) 0, calc(100% - ${ib}%) 100%, ${ib}% 100%)`;
}
function todayISO(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}
function getEventCount(row: InsightRow, types: string[]): number {
  if (!row.actions) return 0;
  return row.actions.filter((a) => types.includes(a.action_type)).reduce((s, a) => s + parseInt(a.value || '0', 10), 0);
}
function getDominantEvent(row: InsightRow): string | null {
  let best: { label: string; count: number } | null = null;
  for (const ev of EVENTS) {
    const count = getEventCount(row, ev.types);
    if (count > 0 && (!best || count > best.count)) best = { label: ev.label, count };
  }
  return best ? `${best.label} (${best.count})` : null;
}

type FunnelItem = { id: string; name: string; cls: string; data: InsightRow; badge?: string | null };

export default function Dashboard() {
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

  useEffect(() => {
    loadInsights(since, until);
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

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al sincronizar con Meta');
      setLastFetched(json.synced_at);
      await loadInsights(since, until);
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

  const selectedCampaigns: FunnelItem[] = useMemo(
    () => selIds.map((id, i) => {
      const data = campaigns.find((c) => c.level_id === id);
      return data ? { id, name: data.level_name, cls: COLOR_CLASSES[i % 3], data } : null;
    }).filter(Boolean) as FunnelItem[],
    [selIds, campaigns]
  );

  // Anuncios que pertenecen a alguna de las campañas seleccionadas,
  // con su conjunto de anuncios resuelto (para agrupar la tabla).
  const orderedAdsets = useMemo(() => {
    const selectedCampaignIds = new Set(selectedCampaigns.map((s) => s.data.level_id));
    return adsets
      .filter((a) => selectedCampaignIds.has(a.campaign_id))
      .map((a) => ({ id: a.level_id, name: a.level_name, dominant: getDominantEvent(a) }));
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
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

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
        <button className="btn primary" style={{ height: 37 }} onClick={() => loadInsights(since, until)} disabled={querying}>
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

          <FunnelGroup items={selectedCampaigns} />

          <AiCardPair payload={{ tipo: 'comparación de campañas', periodo: { since, until }, campañas: selectedCampaigns.map((s) => s.data) }} />

          {selectedCampaigns.map((camp) => {
            const campAdsets: FunnelItem[] = adsets
              .filter((a) => a.campaign_id === camp.data.level_id)
              .map((a, i) => ({ id: a.level_id, name: a.level_name, cls: COLOR_CLASSES[i % 3], data: a, badge: getDominantEvent(a) }));

            return (
              <div key={camp.id}>
                <div className="section-title big">Conjuntos de anuncios — {camp.name}</div>
                {campAdsets.length === 0 ? (
                  <div className="empty-state">Esta campaña no tiene conjuntos de anuncios con actividad en el rango seleccionado.</div>
                ) : (
                  <>
                    <FunnelGroup items={campAdsets} />
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
                <ResultsTable ads={filteredAds} badges={badges} orderedAdsets={orderedAdsets} />
              </div>

              <AiCardPair payload={{ tipo: 'tabla de creativos', periodo: { since, until }, anuncios: filteredAds }} />
            </>
          )}
        </>
      )}
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

// Renderiza un grupo de embudos (campañas o conjuntos de anuncios):
// version escritorio (barras lado a lado en un solo panel) y version
// celular (un embudo completo por item, apilados) - la que se muestra
// depende del ancho de pantalla via CSS, no de JS.
function FunnelGroup({ items }: { items: FunnelItem[] }) {
  if (items.length === 0) return null;
  const gridStyle = { gridTemplateColumns: `repeat(${items.length}, 1fr)` };
  const best = items.reduce((m, s) => (s.data.results > m.data.results ? s : m), items[0]);

  return (
    <>
      <div className="funnel-panel desktop-only">
        <div className="accounts-row" style={gridStyle}>
          {items.map((s) => <AccountBox key={s.id} item={s} />)}
        </div>
        {STAGES.map((st, i) => {
          const top = FUNNEL_WIDTHS[i], bottom = FUNNEL_WIDTHS[i + 1] ?? FUNNEL_WIDTHS[i];
          const cp = clipPath(top, bottom);
          const ref = items[0]?.data;
          const rate = ref && st.rateOf ? pct(ref[st.key] as number, ref[st.rateOf] as number) : null;
          return (
            <div className="funnel-row" key={st.label}>
              <div className="funnel-icon-col"><div className="icon-circle">{st.icon}</div><div><div className="row-label">{st.label}</div><div className="row-desc">{st.desc}</div></div></div>
              <div className="funnel-bars">
                {items.map((s) => (
                  <div className="bar-wrap" key={s.id}>
                    <div className={`bar-shape ${s.cls}`} style={{ clipPath: cp }} />
                    <div className="bar-label">{fmt(s.data[st.key] as number)}</div>
                  </div>
                ))}
              </div>
              <div className="funnel-rate">{rate && <><div className="rate-value">{rate}</div><div className="rate-desc">{st.rateDesc}</div></>}</div>
            </div>
          );
        })}
        <div className="funnel-row">
          <div className="funnel-icon-col"><div className="icon-circle">$</div><div><div className="row-label">COSTO / RESULTADO</div><div className="row-desc">Por conversión</div></div></div>
          <div className="funnel-bars">
            {items.map((s) => {
              const cpFlat = clipPath(FUNNEL_WIDTHS[4], FUNNEL_WIDTHS[4]);
              const cpr = s.data.cost_per_result ? `$${s.data.cost_per_result.toFixed(2)}` : 'SIN CONVERSIONES';
              return (
                <div className="bar-wrap" key={s.id}>
                  <div className={`bar-shape ${s.cls}`} style={{ clipPath: cpFlat, opacity: s.data.results === 0 ? 0.55 : 1 }} />
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
            {STAGES.map((st, i) => {
              const top = FUNNEL_WIDTHS[i], bottom = FUNNEL_WIDTHS[i + 1] ?? FUNNEL_WIDTHS[i];
              const cp = clipPath(top, bottom);
              const rate = st.rateOf ? pct(s.data[st.key] as number, s.data[st.rateOf] as number) : null;
              return (
                <div className="funnel-row" key={st.label}>
                  <div className="funnel-icon-col"><div className="icon-circle">{st.icon}</div><div><div className="row-label">{st.label}</div><div className="row-desc">{st.desc}</div></div></div>
                  <div className="bar-wrap">
                    <div className={`bar-shape ${s.cls}`} style={{ clipPath: cp }} />
                    <div className="bar-label">{fmt(s.data[st.key] as number)}</div>
                  </div>
                  <div className="funnel-rate">{rate && <><div className="rate-value">{rate}</div><div className="rate-desc">{st.rateDesc}</div></>}</div>
                </div>
              );
            })}
            <div className="funnel-row">
              <div className="funnel-icon-col"><div className="icon-circle">$</div><div><div className="row-label">COSTO / RESULT.</div><div className="row-desc">Por conversión</div></div></div>
              <div className="bar-wrap">
                <div className={`bar-shape ${s.cls}`} style={{ clipPath: clipPath(FUNNEL_WIDTHS[4], FUNNEL_WIDTHS[4]), opacity: s.data.results === 0 ? 0.55 : 1 }} />
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
              <li><span className="check">✔</span>{s.data.landing_page_views} visitas a la landing page</li>
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

function AccountBox({ item }: { item: FunnelItem }) {
  return (
    <div className={`account-box ${item.cls}`}>
      <div className="account-logo">M</div>
      <div>
        <div className="account-name">{item.name}</div>
        <div className="account-label">INVERSIÓN TOTAL &nbsp; <span className="account-spend">${item.data.spend.toFixed(2)}</span></div>
        {item.badge && <div className="account-event">Evento de conversión: {item.badge}</div>}
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
type AdsetGroup = { id: string; name: string; dominant: string | null };

function ResultsTable({ ads, badges, orderedAdsets }: { ads: AdRow[]; badges: any; orderedAdsets: AdsetGroup[] }) {
  function Cell({ value, isBest, isWeak, format }: { value: number; isBest: boolean; isWeak: boolean; format: (v: number) => string }) {
    return <td className={isBest ? 'best-cell' : isWeak ? 'weak-cell' : ''}>{format(value)}</td>;
  }

  const colCount = 6 + EVENTS.length; // Anuncio + Alcance + Reprod. + T.prom + T.rep + eventos

  return (
    <table className="results-table">
      <thead>
        <tr>
          <th>Anuncio</th>
          <th>Alc.</th>
          <th>Reprod.</th>
          <th>T.prom</th>
          <th>T.rep</th>
          {EVENTS.map((ev) => <th key={ev.key} title={ev.label}>{ev.short}</th>)}
        </tr>
      </thead>
      <tbody>
        {orderedAdsets.map((as) => {
          const groupAds = ads.filter((a) => a.adsetId === as.id);
          if (groupAds.length === 0) return null;
          return (
            <>
              <tr className="adset-group-row" key={`group-${as.id}`}>
                <td colSpan={colCount}>
                  {as.name} — {as.dominant ? <>Conversión: <span className="conv">{as.dominant}</span></> : <span className="conv">Sin conversiones en el período</span>}
                </td>
              </tr>
              {groupAds.map((a) => {
                const isWeakest = a === badges.weakest;
                const isTopOverall = a === badges.maxReach && a === badges.maxPlaytime;
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

function mdToHtml(md: string) {
  return md
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^- (.*)$/gm, '&nbsp;&nbsp;• $1<br/>')
    .replace(/\n\n/g, '<br/>');
}
