'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

type Snapshot = {
  level: 'campaign' | 'adset' | 'ad';
  level_id: string;
  level_name: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  video_plays: number;
  video_avg_watch_seconds: number;
  video_play_time: number;
  landing_page_views: number;
  results: number;
  cost_per_result: number | null;
  fetched_at: string;
};

function pct(part: number, whole: number) {
  return whole ? `${((part / whole) * 100).toFixed(2).replace('.', ',')}%` : '—';
}
function fmt(n: number) {
  return n.toLocaleString('es-CO');
}

// Se queda solo con el snapshot mas reciente por cada entidad (campaña/anuncio/etc)
function latestPerEntity(rows: Snapshot[]) {
  const map = new Map<string, Snapshot>();
  for (const row of rows) {
    const existing = map.get(row.level_id);
    if (!existing || new Date(row.fetched_at) > new Date(existing.fetched_at)) {
      map.set(row.level_id, row);
    }
  }
  return Array.from(map.values());
}

// Recorte porcentual (nunca en pixeles) para que el embudo nunca se "cruce"
// sin importar el ancho real de pantalla.
function clipPath(topPct: number, bottomPct: number) {
  const it = (100 - topPct) / 2;
  const ib = (100 - bottomPct) / 2;
  return `polygon(${it}% 0, calc(100% - ${it}%) 0, calc(100% - ${ib}%) 100%, ${ib}% 100%)`;
}
const FUNNEL_WIDTHS = [100, 88, 76, 64, 52];

export default function Dashboard() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [selA, setSelA] = useState<string>('');
  const [selB, setSelB] = useState<string>('');

  const loadData = useCallback(async () => {
    setError(null);
    const { data: snapData, error: snapErr } = await supabaseBrowser
      .from('insight_snapshots')
      .select('*')
      .order('fetched_at', { ascending: false })
      .limit(500);

    if (snapErr) {
      setError(`No se pudo leer la base de datos: ${snapErr.message}`);
      setLoading(false);
      return;
    }

    const rows = (snapData as Snapshot[]) || [];
    setSnapshots(rows);
    if (rows.length > 0) setLastFetched(rows[0].fetched_at);

    const campaignRows = latestPerEntity(rows.filter((s) => s.level === 'campaign'));
    if (campaignRows.length > 0) {
      setSelA((prev) => prev || campaignRows[0].level_id);
      setSelB((prev) => prev || campaignRows[1]?.level_id || campaignRows[0].level_id);
    }

    const { data: summaryData } = await supabaseBrowser
      .from('ai_summaries')
      .select('summary_md, generated_at')
      .order('generated_at', { ascending: false })
      .limit(1);

    if (summaryData && summaryData.length > 0) setSummary(summaryData[0].summary_md);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al sincronizar con Meta');
      await loadData();
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
      if (!res.ok) throw new Error(json.error || 'Error al generar el analisis');
      setSummary(json.summary_md);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }

  const campaigns = useMemo(
    () => latestPerEntity(snapshots.filter((s) => s.level === 'campaign')),
    [snapshots]
  );
  const ads = useMemo(() => latestPerEntity(snapshots.filter((s) => s.level === 'ad')), [snapshots]);

  const campaignA = campaigns.find((c) => c.level_id === selA);
  const campaignB = campaigns.find((c) => c.level_id === selB);

  const badges = useMemo(() => {
    if (ads.length === 0) return null;
    const maxReach = ads.reduce((m, a) => (a.reach > m.reach ? a : m), ads[0]);
    const maxPlays = ads.reduce((m, a) => (a.video_plays > m.video_plays ? a : m), ads[0]);
    const maxAvg = ads.reduce((m, a) => (a.video_avg_watch_seconds > m.video_avg_watch_seconds ? a : m), ads[0]);
    const maxPlaytime = ads.reduce((m, a) => (a.video_play_time > m.video_play_time ? a : m), ads[0]);
    const weakest = ads.reduce((m, a) => {
      const scoreA = (maxReach.reach ? a.reach / maxReach.reach : 0) + (maxPlays.video_plays ? a.video_plays / maxPlays.video_plays : 0);
      const scoreM = (maxReach.reach ? m.reach / maxReach.reach : 0) + (maxPlays.video_plays ? m.video_plays / maxPlays.video_plays : 0);
      return scoreA < scoreM ? a : m;
    }, ads[0]);
    return { maxReach, maxPlays, maxAvg, maxPlaytime, weakest };
  }, [ads]);

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1 className="title">Reporte de campañas</h1>
          <p className="subtitle">Datos en vivo desde Meta Ads</p>
          {lastFetched && (
            <p className="period">Última actualización: {new Date(lastFetched).toLocaleString('es-CO')}</p>
          )}
        </div>
        <div className="actions">
          <button className="btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Actualizando…' : 'Actualizar ahora'}
          </button>
          <button className="btn primary" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? 'Analizando…' : 'Generar análisis con IA'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="empty-state">Cargando datos…</div>
      ) : snapshots.length === 0 ? (
        <div className="empty-state">
          Aún no hay datos sincronizados.<br />
          Presiona "Actualizar ahora" para traer la primera carga desde Meta.
        </div>
      ) : (
        <>
          {campaigns.length >= 1 && campaignA && campaignB && (
            <>
              <div className="select-row">
                <select value={selA} onChange={(e) => setSelA(e.target.value)}>
                  {campaigns.map((c) => (
                    <option key={c.level_id} value={c.level_id}>{c.level_name}</option>
                  ))}
                </select>
                <span className="vs-label">vs</span>
                <select value={selB} onChange={(e) => setSelB(e.target.value)}>
                  {campaigns.map((c) => (
                    <option key={c.level_id} value={c.level_id}>{c.level_name}</option>
                  ))}
                </select>
              </div>

              <FunnelCompare a={campaignA} b={campaignB} />
            </>
          )}

          {badges && (
            <>
              <div className="section-title">Comparador de creativos</div>
              <p className="section-sub">Insignias calculadas automáticamente sobre los anuncios activos.</p>
              <div className="badge-row">
                <Badge label="MAYOR ALCANCE" name={badges.maxReach.level_name} value={fmt(badges.maxReach.reach)} />
                <Badge label="MÁS REPRODUCCIONES" name={badges.maxPlays.level_name} value={fmt(badges.maxPlays.video_plays)} />
                <Badge label="MEJOR TIEMPO PROMEDIO" name={badges.maxAvg.level_name} value={`${badges.maxAvg.video_avg_watch_seconds.toFixed(0)}s`} />
                <Badge label="MAYOR TIEMPO DE REPRODUCCIÓN" name={badges.maxPlaytime.level_name} value={fmt(badges.maxPlaytime.video_play_time)} />
              </div>
              <div className="cards-grid">
                {ads.map((ad) => {
                  const isLeader = [badges.maxReach, badges.maxPlays, badges.maxAvg, badges.maxPlaytime].includes(ad);
                  const isWeakest = ad === badges.weakest;
                  return (
                    <div key={ad.level_id} className={`ad-card ${isWeakest ? 'warning' : isLeader ? 'leader' : ''}`}>
                      <div className="name">
                        {ad.level_name}
                        {(ad === badges.maxReach || ad === badges.maxPlaytime) && <span className="crown">★</span>}
                        {isWeakest && <span className="warn-icon">⚠</span>}
                      </div>
                      <div className={`metric-row ${ad === badges.maxReach ? 'starred' : ''}`}><span>Alcance</span><span>{fmt(ad.reach)}</span></div>
                      <div className={`metric-row ${ad === badges.maxPlays ? 'starred' : ''}`}><span>Reproducciones</span><span>{fmt(ad.video_plays)}</span></div>
                      <div className={`metric-row ${ad === badges.maxPlaytime ? 'starred' : ''}`}><span>Tiempo de reproducción</span><span>{fmt(ad.video_play_time)}</span></div>
                      <div className={`metric-row ${ad === badges.maxAvg ? 'starred' : ''}`}><span>Tiempo promedio</span><span>{ad.video_avg_watch_seconds.toFixed(0)}s</span></div>
                      <div className="metric-row"><span>Resultados</span><span>{ad.results}</span></div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="section-title">Lectura del equipo (Gemini)</div>
          {summary ? (
            <div className="ai-panel" dangerouslySetInnerHTML={{ __html: mdToHtml(summary) }} />
          ) : (
            <div className="empty-state">
              Aún no se ha generado un análisis. Presiona "Generar análisis con IA".
            </div>
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

function FunnelCompare({ a, b }: { a: Snapshot; b: Snapshot }) {
  const stages = [
    { icon: '👁', label: 'IMPRESIONES', desc: 'Veces que se mostró el anuncio', va: a.impressions, vb: b.impressions, rate: null as string | null, rateDesc: '' },
    { icon: '👥', label: 'ALCANCE', desc: 'Personas únicas alcanzadas', va: a.reach, vb: b.reach, rate: pct(a.reach, a.impressions), rateDesc: 'Alcance / Impresiones' },
    { icon: '🖱', label: 'CLICS EN EL ENLACE', desc: 'Personas que hicieron clic', va: a.link_clicks, vb: b.link_clicks, rate: pct(a.link_clicks, a.reach), rateDesc: 'Clics / Alcance' },
    { icon: '🌐', label: 'VISITAS A LA LANDING', desc: 'Personas que llegaron a la página', va: a.landing_page_views, vb: b.landing_page_views, rate: pct(a.landing_page_views, a.link_clicks), rateDesc: 'Visitas / Clics' },
    { icon: '📋', label: 'RESULTADOS', desc: 'Conversión configurada', va: a.results, vb: b.results, rate: pct(a.results, a.landing_page_views), rateDesc: 'Resultados / Visitas' },
  ];

  const lastW = FUNNEL_WIDTHS[FUNNEL_WIDTHS.length - 1];
  const cprA = a.cost_per_result ? `$${a.cost_per_result.toFixed(2)}` : 'SIN CONVERSIONES';
  const cprB = b.cost_per_result ? `$${b.cost_per_result.toFixed(2)}` : 'SIN CONVERSIONES';

  const higherSpend = a.spend >= b.spend;
  const summaryA = summaryFor(a, higherSpend, a.reach >= b.reach, a.landing_page_views >= b.landing_page_views);
  const summaryB = summaryFor(b, !higherSpend, a.reach < b.reach, a.landing_page_views < b.landing_page_views);
  const leaderName = a.results >= b.results ? a.level_name : b.level_name;
  const laggardName = a.results >= b.results ? b.level_name : a.level_name;
  const laggardResults = a.results >= b.results ? b.results : a.results;

  return (
    <>
      <div className="funnel-panel">
        <div className="accounts-row">
          <div className="account-box a">
            <div className="account-logo">M</div>
            <div><div className="account-name">{a.level_name}</div><div className="account-label">INVERSIÓN TOTAL &nbsp; <span className="account-spend">${a.spend.toFixed(2)}</span></div></div>
          </div>
          <div className="vs-circle">VS</div>
          <div className="account-box b">
            <div className="account-logo">M</div>
            <div><div className="account-name">{b.level_name}</div><div className="account-label">INVERSIÓN TOTAL &nbsp; <span className="account-spend">${b.spend.toFixed(2)}</span></div></div>
          </div>
        </div>

        {stages.map((s, i) => {
          const top = FUNNEL_WIDTHS[i];
          const bottom = FUNNEL_WIDTHS[i + 1] ?? FUNNEL_WIDTHS[i];
          const cp = clipPath(top, bottom);
          return (
            <div className="funnel-row" key={s.label}>
              <div className="funnel-icon-col">
                <div className="icon-circle">{s.icon}</div>
                <div><div className="row-label">{s.label}</div><div className="row-desc">{s.desc}</div></div>
              </div>
              <div className="funnel-bars">
                <div className="bar a" style={{ clipPath: cp }}>{fmt(s.va)}</div>
                <div className="bar b" style={{ clipPath: cp }}>{fmt(s.vb)}</div>
              </div>
              <div className="funnel-rate">
                {s.rate && <><div className="rate-value">{s.rate}</div><div className="rate-desc">{s.rateDesc}</div></>}
              </div>
            </div>
          );
        })}

        <div className="funnel-row">
          <div className="funnel-icon-col">
            <div className="icon-circle">$</div>
            <div><div className="row-label">COSTO POR RESULTADO</div><div className="row-desc">Inversión por cada resultado</div></div>
          </div>
          <div className="funnel-bars">
            <div className="bar a" style={{ clipPath: clipPath(lastW, lastW), opacity: a.results === 0 ? 0.55 : 1 }}>{cprA}</div>
            <div className="bar b" style={{ clipPath: clipPath(lastW, lastW), opacity: b.results === 0 ? 0.55 : 1, fontSize: b.results === 0 ? 11 : 17 }}>{cprB}</div>
          </div>
          <div className="funnel-rate" />
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-col a"><h4>RESUMEN {a.level_name}</h4><ul>{summaryA.map((i) => <li key={i}><span className="check">✔</span>{i}</li>)}</ul></div>
        <div className="summary-col b"><h4>RESUMEN {b.level_name}</h4><ul>{summaryB.map((i) => <li key={i}><span className="check">✔</span>{i}</li>)}</ul></div>
      </div>

      <div className="insight-bar">
        <span className="bulb">💡</span>
        <span>
          {leaderName} obtuvo {a.results >= b.results ? a.results : b.results} resultado(s), mientras que {laggardName}{' '}
          {laggardResults === 0 ? 'aún no generó resultados' : `generó ${laggardResults}`}. Revisa la creatividad y el paso de conversión del más débil antes de escalar inversión.
        </span>
      </div>
    </>
  );
}

function summaryFor(x: Snapshot, isSpendHigher: boolean, isReachHigher: boolean, isVisitsHigher: boolean) {
  const items: string[] = [];
  items.push(isSpendHigher ? 'Mayor inversión total' : 'Menor inversión total');
  items.push(isReachHigher ? 'Mayor volumen de impresiones y alcance' : `CTR de enlace: ${pct(x.link_clicks, x.reach)}`);
  items.push(`${x.landing_page_views} visitas a la landing page` + (isVisitsHigher ? ' (la mayor cantidad)' : ''));
  if (x.results > 0) {
    items.push(`Generó ${x.results} resultado${x.results > 1 ? 's' : ''}`);
    items.push(`Costo por resultado: $${x.cost_per_result?.toFixed(2)}`);
  } else {
    items.push('No generó resultados en el período');
    items.push('Sin costo por resultado (sin conversiones)');
  }
  return items;
}

function mdToHtml(md: string) {
  return md
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^- (.*)$/gm, '&nbsp;&nbsp;• $1<br/>')
    .replace(/\n\n/g, '<br/>');
}
