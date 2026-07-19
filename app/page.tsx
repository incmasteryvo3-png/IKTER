'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

type InsightRow = {
  level: 'campaign' | 'ad';
  level_id: string;
  level_name: string;
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

export default function Dashboard() {
  const [since, setSince] = useState(todayISO(-30));
  const [until, setUntil] = useState(todayISO());
  const [nCampaigns, setNCampaigns] = useState(2);
  const [campaigns, setCampaigns] = useState<InsightRow[]>([]);
  const [ads, setAds] = useState<InsightRow[]>([]);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const loadInsights = useCallback(async (s: string, u: string) => {
    setQuerying(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights?since=${s}&until=${u}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al consultar Meta.');
      setCampaigns(json.campaigns || []);
      setAds(json.ads || []);
      setSelIds((prev) => {
        const names = (json.campaigns || []).map((c: InsightRow) => c.level_id);
        if (prev.length > 0 && prev.every((id) => names.includes(id))) return prev;
        return names.slice(0, nCampaigns);
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setQuerying(false);
      setLoading(false);
    }
  }, [nCampaigns]);

  useEffect(() => {
    loadInsights(since, until);
    supabaseBrowser
      .from('ai_summaries')
      .select('summary_md, generated_at')
      .order('generated_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (data && data.length > 0) setSummary(data[0].summary_md); });
    supabaseBrowser
      .from('insight_snapshots')
      .select('fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (data && data.length > 0) setLastFetched(data[0].fetched_at); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--n-campaigns', String(nCampaigns));
  }, [nCampaigns]);

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

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch('/api/analyze', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al generar el análisis');
      setSummary(json.summary_md);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
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

  function handleCountChange(n: number) {
    setNCampaigns(n);
    setSelIds((prev) => {
      const ids = campaigns.map((c) => c.level_id);
      const next = [...prev];
      while (next.length < n) next.push(ids[next.length % Math.max(ids.length, 1)]);
      return next.slice(0, n);
    });
  }

  const selected = useMemo(
    () => selIds.map((id, i) => ({
      data: campaigns.find((c) => c.level_id === id),
      cls: COLOR_CLASSES[i],
    })).filter((s) => s.data) as { data: InsightRow; cls: string }[],
    [selIds, campaigns]
  );

  const badges = useMemo(() => {
    if (ads.length === 0) return null;
    const maxReach = ads.reduce((m, a) => (a.reach > m.reach ? a : m), ads[0]);
    const maxPlays = ads.reduce((m, a) => (a.video_plays > m.video_plays ? a : m), ads[0]);
    const maxAvg = ads.reduce((m, a) => (a.video_avg_watch_seconds > m.video_avg_watch_seconds ? a : m), ads[0]);
    const maxPlaytime = ads.reduce((m, a) => (a.video_play_time_estimate > m.video_play_time_estimate ? a : m), ads[0]);
    const weakest = ads.reduce((m, a) => {
      const scoreA = (maxReach.reach ? a.reach / maxReach.reach : 0) + (maxPlays.video_plays ? a.video_plays / maxPlays.video_plays : 0);
      const scoreM = (maxReach.reach ? m.reach / maxReach.reach : 0) + (maxPlays.video_plays ? m.video_plays / maxPlays.video_plays : 0);
      return scoreA < scoreM ? a : m;
    }, ads[0]);
    return { maxReach, maxPlays, maxAvg, maxPlaytime, weakest };
  }, [ads]);

  const best = selected.reduce((m, s) => (s.data.results > m.data.results ? s : m), selected[0]);

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
          <button className="btn primary" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? 'Analizando…' : 'Generar análisis con IA'}
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
              <button key={n} className={nCampaigns === n ? 'active' : ''} onClick={() => handleCountChange(n)}>{n}</button>
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

          {/* Escritorio: barras lado a lado por etapa */}
          <div className="funnel-panel desktop-only">
            <div className="accounts-row">
              {selected.map((s) => (
                <div key={s.data.level_id} className={`account-box ${s.cls}`}>
                  <div className="account-logo">M</div>
                  <div>
                    <div className="account-name">{s.data.level_name}</div>
                    <div className="account-label">INVERSIÓN TOTAL &nbsp; <span className="account-spend">${s.data.spend.toFixed(2)}</span></div>
                  </div>
                </div>
              ))}
            </div>
            {STAGES.map((st, i) => {
              const top = FUNNEL_WIDTHS[i], bottom = FUNNEL_WIDTHS[i + 1] ?? FUNNEL_WIDTHS[i];
              const cp = clipPath(top, bottom);
              const ref = selected[0]?.data;
              const rate = ref && st.rateOf ? pct(ref[st.key] as number, ref[st.rateOf] as number) : null;
              return (
                <div className="funnel-row" key={st.label}>
                  <div className="funnel-icon-col"><div className="icon-circle">{st.icon}</div><div><div className="row-label">{st.label}</div><div className="row-desc">{st.desc}</div></div></div>
                  <div className="funnel-bars">
                    {selected.map((s) => (
                      <div className="bar-wrap" key={s.data.level_id}>
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
                {selected.map((s) => {
                  const cpFlat = clipPath(FUNNEL_WIDTHS[4], FUNNEL_WIDTHS[4]);
                  const cpr = s.data.cost_per_result ? `$${s.data.cost_per_result.toFixed(2)}` : 'SIN CONVERSIONES';
                  return (
                    <div className="bar-wrap" key={s.data.level_id}>
                      <div className={`bar-shape ${s.cls}`} style={{ clipPath: cpFlat, opacity: s.data.results === 0 ? 0.55 : 1 }} />
                      <div className={`bar-label ${s.data.results === 0 ? 'dim' : ''}`}>{cpr}</div>
                    </div>
                  );
                })}
              </div>
              <div className="funnel-rate" />
            </div>
          </div>

          {/* Celular: un embudo completo por campaña, apilados */}
          <div className="funnels-grid mobile-only">
            {selected.map((s) => (
              <div className="funnel-single" key={s.data.level_id}>
                <div className={`account-box ${s.cls}`}>
                  <div className="account-logo">M</div>
                  <div>
                    <div className="account-name">{s.data.level_name}</div>
                    <div className="account-label">INVERSIÓN TOTAL &nbsp; <span className="account-spend">${s.data.spend.toFixed(2)}</span></div>
                  </div>
                </div>
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

          <div className="summary-grid">
            {selected.map((s) => (
              <div className={`summary-col ${s.cls}`} key={s.data.level_id}>
                <h4>RESUMEN {s.data.level_name}</h4>
                <ul>
                  <li><span className="check">✔</span>{s.data.results} resultado{s.data.results !== 1 ? 's' : ''} generado{s.data.results !== 1 ? 's' : ''}</li>
                  <li><span className="check">✔</span>{s.data.cost_per_result ? `Costo por resultado: $${s.data.cost_per_result.toFixed(2)}` : 'Sin costo por resultado (sin conversiones)'}</li>
                  <li><span className="check">✔</span>{s.data.landing_page_views} visitas a la landing page</li>
                </ul>
              </div>
            ))}
          </div>

          {best && (
            <div className="insight-bar">
              <span className="bulb">💡</span>
              <span>{best.data.level_name} lidera con {best.data.results} resultado(s) en el período seleccionado. Revisa la creatividad y el paso de conversión de las campañas más débiles antes de escalar inversión.</span>
            </div>
          )}

          {badges && (
            <>
              <div className="section-title">Comparador de creativos</div>
              <p className="section-sub">Insignias calculadas automáticamente sobre los anuncios activos en el rango seleccionado.</p>
              <div className="badge-row">
                <Badge label="MAYOR ALCANCE" name={badges.maxReach.level_name} value={fmt(badges.maxReach.reach)} />
                <Badge label="MÁS REPRODUCCIONES" name={badges.maxPlays.level_name} value={fmt(badges.maxPlays.video_plays)} />
                <Badge label="MEJOR TIEMPO PROMEDIO" name={badges.maxAvg.level_name} value={`${badges.maxAvg.video_avg_watch_seconds.toFixed(0)}s`} />
                <Badge label="MAYOR TIEMPO DE REPRODUCCIÓN" name={badges.maxPlaytime.level_name} value={fmt(badges.maxPlaytime.video_play_time_estimate)} />
              </div>

              <div className="results-table-wrap">
                <ResultsTable ads={ads} badges={badges} />
              </div>
            </>
          )}
        </>
      )}

      <div className="section-title">Lectura del equipo (Gemini)</div>
      {summary ? (
        <div className="ai-panel" dangerouslySetInnerHTML={{ __html: mdToHtml(summary) }} />
      ) : (
        <div className="empty-state">Aún no se ha generado un análisis. Presiona "Generar análisis con IA".</div>
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

function ResultsTable({ ads, badges }: { ads: InsightRow[]; badges: any }) {
  const maxReach = Math.max(...ads.map((a) => a.reach), 1);
  const maxPlays = Math.max(...ads.map((a) => a.video_plays), 1);
  const maxPlaytime = Math.max(...ads.map((a) => a.video_play_time_estimate), 1);
  const maxAvg = Math.max(...ads.map((a) => a.video_avg_watch_seconds), 1);
  const maxResults = Math.max(...ads.map((a) => a.results), 1);

  function BarCell({ value, max, isBest, isWeak, format }: { value: number; max: number; isBest: boolean; isWeak: boolean; format: (v: number) => string }) {
    const pctH = Math.max(8, Math.round((value / max) * 100));
    return (
      <td className={`bar-cell ${isBest ? 'best' : isWeak ? 'weak' : ''}`}>
        <div className="bar-track"><div className="bar-fill" style={{ height: `${pctH}%` }} /></div>
        <div className="bar-value">{format(value)}</div>
      </td>
    );
  }

  return (
    <table className="results-table">
      <thead><tr><th>Anuncio</th><th>Alcance</th><th>Reprod.</th><th>T. prom.</th><th>T. reprod.</th><th>Result.</th></tr></thead>
      <tbody>
        {ads.map((a) => {
          const isWeakest = a === badges.weakest;
          const isTopOverall = a === badges.maxReach && a === badges.maxPlaytime;
          return (
            <tr key={a.level_id} className={isTopOverall ? 'best-row' : ''}>
              <td>
                <div className="ad-name-cell">
                  {(a === badges.maxReach || a === badges.maxPlaytime) && <span className="crown">★</span>}
                  {isWeakest && <span className="warn">⚠</span>}
                  {a.level_name}
                </div>
              </td>
              <BarCell value={a.reach} max={maxReach} isBest={a === badges.maxReach} isWeak={isWeakest} format={fmt} />
              <BarCell value={a.video_plays} max={maxPlays} isBest={a === badges.maxPlays} isWeak={isWeakest} format={fmt} />
              <BarCell value={a.video_avg_watch_seconds} max={maxAvg} isBest={a === badges.maxAvg} isWeak={isWeakest} format={(v) => `${v.toFixed(0)}s`} />
              <BarCell value={a.video_play_time_estimate} max={maxPlaytime} isBest={a === badges.maxPlaytime} isWeak={isWeakest} format={fmt} />
              <BarCell value={a.results} max={maxResults} isBest={a.results === maxResults && maxResults > 0} isWeak={a.results === 0} format={fmt} />
            </tr>
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
