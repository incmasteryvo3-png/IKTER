'use client';

// ============================================================
// Pestaña "Diagnóstico" — análisis de las métricas en vivo, unas contra
// otras, día por día. Basado en el "Panel de diagnóstico de anuncios"
// (mismo visual), pero alimentado EN VIVO desde Meta via
// /api/insights/daily y con un par de tarjetas de IA (Gemini + Claude)
// debajo de CADA gráfica.
//
// Es un componente aislado: no lee ni modifica nada del Dashboard,
// solo comparte el rango de fechas que se le pasa por props.
// ============================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSavedAnalysis, forgetSaved, SavedHistory, fmtSavedDate } from '@/components/aiSaved';

type Level = 'ad' | 'adset' | 'campaign';

type Series = {
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
type Video = { reproducciones: number; tiempo_prom: number; thruplays: number; r25: number | null; r50: number | null; r75: number | null; r100: number | null };
type Entity = {
  id: string;
  name: string;
  level: Level;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  inicio: string | null;
  fin: string | null;
  evento: string | null;
  totales: { gasto: number; impresiones: number; resultados: number; clics_enlace: number };
  series: Series;
  video: Video | null;
  label?: string; // nombre para listas: si el nombre se repite, se le agrega el conjunto
};

// ---- Marca visible del panel ----
const PANEL_BRAND = 'MASTERY · Panel de diagnóstico';
const AI_NAMES = { gemini: 'VISION', claude: 'ATALAYA' };

const ENTITY_COLORS = ['#378ADD', '#5DCAA5', '#F0997B', '#D4537E', '#D85A30', '#EF9F27', '#1D9E75', '#8F7EE8', '#E87BA4', '#4FB3BF', '#C9A227', '#9BC53D'];

// Orden de lectura: resultado de negocio -> eficiencia -> contexto -> otros
type MetricSpec = {
  key: keyof Series; label: string; color: string; width: number; glow?: number; tier: 0 | 1 | 2 | 3; fmt: (v: number) => string;
  desc: string;   // qué indica, en lenguaje simple (se muestra en el glosario y se manda a las IAs)
  read: string;   // cómo leerla: cuándo es buena o mala señal
};
const money = (v: number) => `$${v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (v: number) => v.toLocaleString('es-CO');
const METRICS: MetricSpec[] = [
  { key: 'costo_resultado', label: 'Costo por resultado', color: '#d4a94c', width: 3.5, glow: 14, tier: 0, fmt: money , desc: 'Cuánto pagas, en promedio, por cada resultado (lead, cita, suscripción…). Es la métrica que dice si la campaña es rentable.', read: 'Mientras más baja, mejor. Si sube varios días seguidos, algo en la cadena se está encareciendo.' },
  { key: 'ctr', label: 'CTR', color: '#1baf7a', width: 2.5, glow: 7, tier: 1, fmt: (v) => `${v.toFixed(2)}%` , desc: 'Porcentaje de veces que alguien hizo clic sobre las veces que se mostró el anuncio. Mide qué tan atractivo es el anuncio para quien lo ve.', read: 'Más alto = el anuncio engancha. Si cae día tras día, el público se está cansando de verlo.' },
  { key: 'frecuencia', label: 'Frecuencia', color: '#378ADD', width: 1.8, tier: 2, fmt: (v) => v.toFixed(2) , desc: 'Cuántas veces, en promedio, vio el anuncio una misma persona ese día.', read: 'Si sube mientras el CTR baja, le estás mostrando el anuncio a la misma gente una y otra vez.' },
  { key: 'alcance', label: 'Alcance', color: '#eb6834', width: 1.8, tier: 2, fmt: int , desc: 'Cuántas personas distintas vieron el anuncio.', read: 'Si se estanca mientras la frecuencia sube, el anuncio ya llegó a casi todo su público disponible.' },
  { key: 'cpm', label: 'CPM', color: '#eda100', width: 1.8, tier: 2, fmt: money , desc: 'Lo que cuesta mostrar el anuncio 1.000 veces. Es el «precio de la subasta» de Meta.', read: 'Si sube, cada impresión sale más cara: más competencia o un anuncio que Meta considera menos relevante.' },
  { key: 'clics_enlace', label: 'Clics en el enlace', color: '#e87ba4', width: 1.4, tier: 3, fmt: int , desc: 'Clics que llevan a la persona a tu página de destino (no cuenta likes ni clics en el perfil).', read: 'Si hay muchos clics pero pocos resultados, el problema suele estar en la página o en la oferta, no en el anuncio.' },
  { key: 'resultados', label: 'Resultados', color: '#6250d6', width: 1.4, tier: 3, fmt: int , desc: 'Cantidad de conversiones del evento que estás optimizando (el objetivo del conjunto).', read: 'Es lo que importa al final: compáralo siempre contra el gasto del mismo día.' },
  { key: 'impresiones', label: 'Impresiones', color: '#008300', width: 1.4, tier: 3, fmt: int , desc: 'Cuántas veces se mostró el anuncio en total (una persona puede contar varias veces).', read: 'Por sí sola no dice si va bien o mal; sirve de contexto para el resto.' },
  { key: 'gasto', label: 'Gasto (USD)', color: '#e34948', width: 1.4, tier: 3, fmt: money , desc: 'Dinero invertido en el anuncio ese día.', read: 'Si el gasto sube y los resultados no lo acompañan, el presupuesto se está quemando.' },
];
const TIER_LABELS = ['Mirar primero', 'Eficiencia', 'Contexto', 'Otros datos'];

// Combinaciones típicas: cómo leer dos o más métricas a la vez.
const COMBOS: { when: string; means: string }[] = [
  { when: 'CPM sube + CTR baja', means: 'Fatiga del creativo: la gente ya lo vio y Meta cobra más por mostrarlo. Momento de renovar el anuncio.' },
  { when: 'Frecuencia sube + alcance estancado', means: 'Audiencia saturada: siempre le llega a las mismas personas. Amplía el público o cambia el creativo.' },
  { when: 'CTR alto + pocos resultados', means: 'El anuncio funciona, pero la página o la oferta no convierten. Revisa la landing, no el anuncio.' },
  { when: 'Gasto sube + resultados planos', means: 'El costo por resultado se dispara: el presupuesto extra no está trayendo más conversiones.' },
  { when: 'Más gasto + costo por resultado estable', means: 'Escala sana: puedes seguir subiendo presupuesto con cuidado.' },
  { when: 'Días sin datos en medio', means: 'Pausa o corte de entrega. Al reactivar, Meta puede volver a «fase de aprendizaje» y los costos suben unos días.' },
];
const GLOSSARY_FOR_AI = METRICS.map((m) => `- ${m.label}: ${m.desc} ${m.read}`).join('\n');
const COMBOS_FOR_AI = COMBOS.map((c) => `- ${c.when} → ${c.means}`).join('\n');

const LEVEL_LABELS: Record<Level, { tab: string; tag: string }> = {
  ad: { tab: 'Anuncios', tag: 'Anuncio individual' },
  adset: { tab: 'Conjuntos', tag: 'Conjunto de anuncios' },
  campaign: { tab: 'Campañas', tag: 'Campaña' },
};

// ------------------------------------------------------------------
// Chart.js se carga solo en el navegador y una sola vez.
// ------------------------------------------------------------------
let chartPromise: Promise<any> | null = null;
function loadChart(): Promise<any> {
  if (!chartPromise) {
    chartPromise = import('chart.js/auto').then((mod) => {
      const Chart = mod.default;
      const glowPlugin = {
        id: 'dgGlow',
        beforeDatasetDraw(chart: any, args: any) {
          const ds = chart.data.datasets[args.index];
          if (ds && ds.glow) { chart.ctx.save(); chart.ctx.shadowColor = ds.borderColor; chart.ctx.shadowBlur = ds.glowStrength || 10; }
        },
        afterDatasetDraw(chart: any, args: any) {
          const ds = chart.data.datasets[args.index];
          if (ds && ds.glow) chart.ctx.restore();
        },
      };
      // Franjas para dias sin NINGUNA fila de datos de Meta dentro de la
      // ventana activa (posible pausa o corte de entrega).
      const gapPlugin = {
        id: 'dgGap',
        beforeDatasetsDraw(chart: any) {
          const gaps: number[] | undefined = chart.options.plugins?.dgGap?.gaps;
          if (!gaps || !gaps.length) return;
          const { ctx, chartArea, scales } = chart;
          ctx.save();
          ctx.fillStyle = chart.options.plugins?.dgGap?.color || 'rgba(255,255,255,0.035)';
          gaps.forEach((i) => {
            const x0 = scales.x.getPixelForValue(i - 0.5);
            const x1 = scales.x.getPixelForValue(i + 0.5);
            ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
          });
          ctx.restore();
        },
      };
      Chart.register(glowPlugin, gapPlugin);
      return Chart;
    });
  }
  return chartPromise;
}

function useChart(config: () => any, deps: any[]) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let chart: any = null;
    let cancelled = false;
    loadChart().then((Chart) => {
      if (cancelled || !ref.current) return;
      chart = new Chart(ref.current, config());
    });
    return () => { cancelled = true; if (chart) chart.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

// Lee los colores del tema actual (variables CSS del panel) para que la
// version de marca blanca pueda cambiarlos solo desde CSS.
function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const el = document.querySelector('.dg-root') || document.documentElement;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}
function themeColors() {
  return {
    text: cssVar('--dg-text', '#eeeeec'),
    dim: cssVar('--dg-text-dim', '#9a9c9f'),
    mute: cssVar('--dg-text-mute', '#6b6d70'),
    surface2: cssVar('--dg-surface-2', '#1c1f22'),
    border: cssVar('--dg-border', '#2a2d31'),
    gap: cssVar('--dg-gap-fill', 'rgba(255,255,255,0.035)'),
    accent: cssVar('--dg-accent', '#d4a94c'),
  };
}

// ------------------------------------------------------------------
function normalize(arr: (number | null)[]) {
  const nums = arr.filter((v): v is number => v !== null && v !== undefined);
  if (!nums.length) return arr.map(() => null);
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min || 1;
  return arr.map((v) => (v === null || v === undefined ? null : Math.round(((v - min) / range) * 100)));
}
function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}
function fmtLongRange(a: string, b: string) {
  const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const da = new Date(`${a}T00:00:00`), db = new Date(`${b}T00:00:00`);
  return `${da.toLocaleDateString('es-ES', o)} a ${db.toLocaleDateString('es-ES', { ...o, year: 'numeric' })}`;
}
function activeSlice<T>(arr: T[], dates: string[], e: Entity): T[] {
  const s = dates.indexOf(e.inicio!), f = dates.indexOf(e.fin!);
  return arr.slice(s, f + 1);
}
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function mdToHtml(md: string) {
  return escapeHtml(md)
    .replace(/^#{2,3} (.*)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*] (.*)$/gm, '<div class="dg-li">• $1</div>')
    .replace(/\n{2,}/g, '<br/>')
    .replace(/(<br\/>\s*)+(<h4>)/g, '$2')
    .replace(/\n/g, ' ');
}

// ------------------------------------------------------------------
// Prompt especifico para leer GRAFICAS (relaciones entre metricas en el
// tiempo), distinto del prompt general del Dashboard. Se manda por el
// campo "prompt" que /api/analyze/gemini y /api/analyze/claude ya
// aceptaban - no hizo falta tocar esas rutas.
// ------------------------------------------------------------------
function buildChartPrompt(kind: string, data: unknown) {
  return `
Eres un media buyer senior de Meta Ads y, a la vez, un PROFESOR. Quien te lee
puede no dominar Meta Ads: tu análisis debe servir para decidir Y para aprender.
Vas a leer una GRÁFICA de diagnóstico:
${kind}

Tu trabajo es leer las métricas UNAS CONTRA OTRAS a lo largo de los días, no
describirlas por separado. Orden de lectura profesional: primero el resultado
de negocio (costo por resultado, resultados), luego la eficiencia (CTR), y al
final el contexto de entrega (frecuencia, alcance, CPM, gasto).

Glosario que ve la persona en pantalla (usa estas mismas definiciones y palabras):
${GLOSSARY_FOR_AI}

Combinaciones típicas para guiarte (confírmalas o descártalas con los datos):
${COMBOS_FOR_AI}
Para video (si viene): dónde se cae la retención (25/50/75/100%) y qué dice del gancho.

Reglas de profesor:
- Cada vez que relaciones dos métricas, explica en una frase simple qué mide cada
  una y POR QUÉ esa combinación indica lo que dices (ej.: "el CPM, que es lo que
  cuesta mostrar el anuncio, subió de $X a $Y mientras el CTR, que mide cuánta
  gente hace clic, bajó de A% a B%: eso suele ser fatiga del creativo porque...").
- Lenguaje claro, sin jerga sin explicar. Si usas un término técnico (fase de
  aprendizaje, subasta, fatiga), explícalo en pocas palabras la primera vez.
- Siempre con fechas y números reales del JSON.

Datos (JSON). Los arreglos son día por día y alineados con "fechas"; null = Meta
no exportó ninguna fila ese día. Usa SIEMPRE los valores reales del JSON:
${JSON.stringify(data, null, 2)}

Responde en español, en este formato exacto (markdown):

## Lectura de la gráfica
- (2 a 4 puntos: qué pasó, en qué fechas, con números del JSON)

## Relaciones entre métricas
- (2 a 4 puntos: qué métrica se movió por culpa de cuál, con fechas, explicando
  qué significa cada métrica y por qué la combinación indica eso)

## Señales de alerta
- (1 a 3 puntos; si no hay, dilo)

## Acción recomendada
(1 párrafo corto, máximo 3 frases, acción concreta y priorizada)

## Lo que te enseña esta gráfica
- (1 o 2 lecciones cortas y reutilizables que la persona pueda aplicar a otros
  anuncios, basadas en lo que se vio aquí)

No inventes números. Si un dato falta o es insuficiente para concluir, dilo.
`.trim();
}

// sectionId: que grafica es (sin la cuenta); se le antepone la cuenta para
// guardar/buscar el analisis. period: rango consultado.
type DiagSave = { sectionId: string; period: { since: string; until: string }; sectionTitle: string };

function DiagAiPair({ kind, payload, save }: { kind: string; payload: unknown; save: DiagSave }) {
  return (
    <div className="dg-ai-row">
      <DiagAiCard provider="gemini" kind={kind} payload={payload} save={save} />
      <DiagAiCard provider="claude" kind={kind} payload={payload} save={save} />
    </div>
  );
}

// Cuenta publicitaria activa: el nombre da contexto a las IAs y el id
// separa los analisis guardados por cuenta.
const AccountNameCtx = createContext<{ id: string; name: string }>({ id: '', name: '' });

function DiagAiCard({ provider, kind, payload, save }: { provider: 'gemini' | 'claude'; kind: string; payload: unknown; save: DiagSave }) {
  const { id: accountId, name: accountName } = useContext(AccountNameCtx);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [fromSaved, setFromSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const title = AI_NAMES[provider];
  const sectionKey = `${accountId}|${save.sectionId}`;
  const { exact, history, hash } = useSavedAnalysis(provider, sectionKey, payload);

  useEffect(() => {
    if (exact && !summary) { setSummary(exact.summary_md); setSavedAt(exact.generated_at); setFromSaved(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exact]);

  async function generate() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/analyze/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: payload,
          prompt: buildChartPrompt(accountName ? `${kind} — cuenta publicitaria "${accountName}"` : kind, payload),
          section_key: sectionKey, data_hash: hash || undefined, period: save.period, account: accountId || undefined, title: save.sectionTitle,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al generar el análisis');
      setSummary(json.summary_md);
      setSavedAt(json.saved_at || null);
      setFromSaved(false);
      forgetSaved(sectionKey);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`dg-ai-card ${provider}`}>
      <div className="dg-ai-head">
        <span className="dg-ai-title">{provider === 'gemini' ? '✦' : '◆'} {title}</span>
        <button className="dg-btn small" onClick={generate} disabled={loading}>
          {loading ? 'Analizando…' : summary ? 'Actualizar' : 'Analizar gráfica'}
        </button>
      </div>
      {savedAt && summary && (
        <div className="dg-saved-note">{fromSaved ? `Guardado el ${fmtSavedDate(savedAt)} · mismos datos, no se volvió a cobrar` : `Guardado el ${fmtSavedDate(savedAt)}`}</div>
      )}
      {err && <div className="dg-ai-error">{err}</div>}
      {summary ? (
        <div className="dg-ai-body" dangerouslySetInnerHTML={{ __html: mdToHtml(summary) }} />
      ) : !loading && !err ? (
        <div className="dg-ai-empty">{title} lee esta gráfica cruzando las métricas entre sí.</div>
      ) : loading ? (
        <div className="dg-ai-empty">Leyendo la gráfica…</div>
      ) : null}
      <SavedHistory rows={history} render={mdToHtml} className="dg-history" />
    </div>
  );
}

// ------------------------------------------------------------------
// Tarjeta de una entidad (anuncio / conjunto / campaña)
// ------------------------------------------------------------------
function EntityCard({ e, dates, since, until }: { e: Entity; dates: string[]; since: string; until: string }) {
  const s = dates.indexOf(e.inicio!);
  const f = dates.indexOf(e.fin!);
  const activeDates = dates.slice(s, f + 1);
  const imp = activeSlice(e.series.impresiones, dates, e);
  const gaps = imp.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);

  const canvasRef = useChart(() => {
    const t = themeColors();
    const datasets = METRICS.map((m) => {
      const raw = activeSlice(e.series[m.key], dates, e);
      return {
        label: m.label,
        data: normalize(raw),
        rawData: raw,
        fmt: m.fmt,
        borderColor: m.color,
        backgroundColor: m.color,
        borderWidth: m.width,
        pointRadius: m.glow ? 2.5 : 0,
        tension: 0.25,
        order: m.tier,
        glow: Boolean(m.glow),
        glowStrength: m.glow || 0,
        spanGaps: false,
      };
    });
    return {
      type: 'line',
      data: { labels: activeDates.map(fmtDate), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: t.dim, boxWidth: 10, font: { size: 10.5 } } },
          tooltip: {
            backgroundColor: t.surface2, borderColor: t.border, borderWidth: 1, titleColor: t.text, bodyColor: t.dim,
            callbacks: {
              label: (c: any) => {
                const v = c.dataset.rawData[c.dataIndex];
                return `${c.dataset.label}: ${v === null || v === undefined ? 'sin dato' : c.dataset.fmt(v)}`;
              },
            },
          },
          dgGap: { gaps, color: t.gap },
        },
        scales: {
          y: { min: 0, max: 100, title: { display: true, text: 'Índice (0-100)', color: t.mute, font: { size: 10 } }, ticks: { color: t.mute, font: { size: 10 } }, grid: { color: t.surface2 } },
          x: { ticks: { color: t.mute, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } },
        },
      },
    };
  }, [e.id, dates.join(',')]);

  const payload = useMemo(() => {
    const serie: Record<string, any> = {};
    METRICS.forEach((m) => { serie[m.label] = activeSlice(e.series[m.key], dates, e); });
    return {
      tipo: `gráfica diaria — ${LEVEL_LABELS[e.level].tag.toLowerCase()}`,
      entidad: e.name,
      campaña: e.campaign_name,
      conjunto: e.adset_name,
      evento_de_conversion: e.evento,
      periodo_consultado: { since, until },
      ventana_activa: { inicio: e.inicio, fin: e.fin, dias_sin_datos: gaps.map((i) => activeDates[i]) },
      totales: e.totales,
      fechas: activeDates,
      serie_diaria: serie,
      video: e.video,
    };
  }, [e, dates, since, until, gaps, activeDates]);

  return (
    <div className="dg-card">
      <div className="dg-ad-head">
        <div>
          <span className="dg-tipo-tag">{LEVEL_LABELS[e.level].tag}</span>
          <h2>{e.name}</h2>
          <div className="dg-ad-meta">
            {e.level === 'ad' && e.adset_name && <div>Conjunto: <b>{e.adset_name}</b></div>}
            {e.level !== 'campaign' && e.campaign_name && <div>Campaña: <b>{e.campaign_name}</b></div>}
            <div>{e.level === 'campaign' ? 'Objetivo' : 'Evento de conversión'}: <b>{e.evento || 'No detectado'}</b></div>
          </div>
        </div>
        <div className="dg-ad-dates">
          Activo
          <span className="dg-range">{fmtDate(e.inicio!)} – {fmtDate(e.fin!)}</span>
          <div className="dg-totals">
            {money(e.totales.gasto)} · {int(e.totales.resultados)} resultado{e.totales.resultados !== 1 ? 's' : ''}
            {e.totales.resultados > 0 && <> · {money(e.totales.gasto / e.totales.resultados)} c/u</>}
          </div>
        </div>
      </div>
      <div className="dg-chart-wrap"><canvas ref={canvasRef} role="img" aria-label={`Métricas diarias de ${e.name}`} /></div>
      <div className="dg-gap-note"><span className="dg-gap-swatch" />Día sin ninguna fila de datos en Meta (posible pausa o corte de entrega)</div>
      <DiagAiPair
        kind={`métricas diarias de "${e.name}" (${LEVEL_LABELS[e.level].tag}), indexadas 0-100 para compararlas en el mismo eje`}
        payload={payload}
        save={{ sectionId: `diag-${e.level}|${e.id}`, period: { since, until }, sectionTitle: `Diagnóstico: ${e.name}` }}
      />
    </div>
  );
}

// ------------------------------------------------------------------
function RetentionCard({ entities, colorOf, since, until }: { entities: Entity[]; colorOf: (id: string) => string; since: string; until: string }) {
  const withVideo = entities.filter((e) => e.video);
  const canvasRef = useChart(() => {
    const t = themeColors();
    return {
      type: 'line',
      data: {
        labels: ['25%', '50%', '75%', '100%'],
        datasets: withVideo.map((e) => ({
          label: e.label || e.name,
          data: [e.video!.r25, e.video!.r50, e.video!.r75, e.video!.r100],
          borderColor: colorOf(e.id), backgroundColor: colorOf(e.id), borderWidth: 2, pointRadius: 3, tension: 0.2,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: t.dim, boxWidth: 10, font: { size: 10.5 } } },
          tooltip: { backgroundColor: t.surface2, borderColor: t.border, borderWidth: 1, titleColor: t.text, bodyColor: t.dim, callbacks: { label: (c: any) => `${c.dataset.label}: ${c.raw ?? 'sin dato'}%` } },
        },
        scales: {
          y: { title: { display: true, text: '% de reproducciones que llegaron ahí', color: t.mute, font: { size: 10 } }, ticks: { color: t.mute, font: { size: 10 } }, grid: { color: t.surface2 } },
          x: { ticks: { color: t.mute, font: { size: 10 } }, grid: { display: false } },
        },
      },
    };
  }, [withVideo.map((e) => e.id).join(',')]);

  if (withVideo.length === 0) return null;
  const best = withVideo.reduce((m, e) => ((e.video!.r25 || 0) > (m.video!.r25 || 0) ? e : m), withVideo[0]);

  return (
    <section className="dg-card">
      <p className="dg-section-title">Retención y reproducción del creativo (video)</p>
      <p className="dg-section-sub">Agregado del período completo (Meta no reporta la retención de video de forma confiable día por día). Porcentajes sobre el total de reproducciones de cada anuncio. <b>Cómo leerla:</b> el 25% mide el gancho (los primeros segundos); si casi todos se van antes, el inicio del video no atrapa. Si el 25% es bueno pero cae fuerte al 50%, el gancho funciona pero el desarrollo pierde interés. El 100% indica cuántos ven el mensaje completo (incluida la llamada a la acción).</p>
      <div className="dg-table-wrap">
        <table className="dg-video-table">
          <thead>
            <tr><th>Entidad</th><th className="num">Reproducciones</th><th className="num">ThruPlays</th><th className="num">Tiempo prom. (s)</th><th className="num">Retención 25%</th><th className="num">50%</th><th className="num">75%</th><th className="num">100%</th></tr>
          </thead>
          <tbody>
            {withVideo.map((e) => (
              <tr key={e.id}>
                <td><span className="dg-dot" style={{ background: colorOf(e.id) }} />{e.label || e.name}</td>
                <td className="num">{int(e.video!.reproducciones)}</td>
                <td className="num">{int(e.video!.thruplays)}</td>
                <td className="num">{e.video!.tiempo_prom}</td>
                <td className={`num ${e.id === best.id ? 'hero' : ''}`}>{e.video!.r25 ?? '—'}%</td>
                <td className="num">{e.video!.r50 ?? '—'}%</td>
                <td className="num">{e.video!.r75 ?? '—'}%</td>
                <td className="num">{e.video!.r100 ?? '—'}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dg-section-sub" style={{ marginTop: 22 }}>Curva de retención — dónde se cae la atención en cada video</p>
      <div className="dg-chart-wrap" style={{ height: 280 }}><canvas ref={canvasRef} role="img" aria-label="Curva de retención de video por entidad" /></div>
      <DiagAiPair
        kind="curva de retención de video (25/50/75/100%) comparando varios creativos entre sí"
        save={{ sectionId: `diag-retencion|${withVideo.map((e) => e.id).join('+')}`, period: { since, until }, sectionTitle: 'Diagnóstico: retención de video' }}
        payload={{ tipo: 'retención de video', periodo: { since, until }, creativos: withVideo.map((e) => ({ nombre: e.label || e.name, conjunto: e.adset_name, campaña: e.campaign_name, ...e.video, gasto: e.totales.gasto, resultados: e.totales.resultados })) }}
      />
    </section>
  );
}

// ------------------------------------------------------------------
function FacetRow({ e, dates, color }: { e: Entity; dates: string[]; color: string }) {
  const ref = useChart(() => {
    const t = themeColors();
    return {
      type: 'line',
      data: { labels: dates, datasets: [{ data: e.series.frecuencia, borderColor: color, backgroundColor: color + '26', fill: true, borderWidth: 2, pointRadius: 2, spanGaps: false, tension: 0.25 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: t.surface2, borderColor: t.border, borderWidth: 1, titleColor: t.text, bodyColor: t.dim, callbacks: { title: (items: any[]) => fmtDate(dates[items[0].dataIndex]), label: (it: any) => `Frecuencia: ${it.raw === null ? 'sin dato' : it.raw}` } },
        },
        scales: { y: { display: false }, x: { display: false } },
      },
    };
  }, [e.id, dates.join(',')]);
  return (
    <div className="dg-facet-row">
      <div className="dg-facet-label" title={e.label || e.name}>{e.label || e.name}</div>
      <div className="dg-facet-chart"><canvas ref={ref} /></div>
    </div>
  );
}

function AxisRow({ dates }: { dates: string[] }) {
  const ref = useChart(() => {
    const t = themeColors();
    return {
      type: 'line',
      data: { labels: dates.map(fmtDate), datasets: [{ data: dates.map(() => 0), borderWidth: 0, pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { y: { display: false }, x: { ticks: { color: t.mute, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { display: false } } } },
    };
  }, [dates.join(',')]);
  return (
    <div className="dg-facet-axis"><div className="dg-facet-axis-spacer" /><div className="dg-chart-wrap" style={{ height: 24, flex: 1, marginTop: 0 }}><canvas ref={ref} /></div></div>
  );
}

function TimelineCard({ entities, dates, colorOf, since, until }: { entities: Entity[]; dates: string[]; colorOf: (id: string) => string; since: string; until: string }) {
  const total = dates.length;
  return (
    <section className="dg-card">
      <p className="dg-section-title">Cuándo estuvo activo cada uno</p>
      <p className="dg-section-sub">Cada barra marca el rango de fechas real de entrega (primer y último día con impresiones). Sirve para ver qué anuncios compitieron entre sí al mismo tiempo por el mismo presupuesto y público.</p>
      <div>
        {entities.map((e) => {
          const s = dates.indexOf(e.inicio!), f = dates.indexOf(e.fin!);
          return (
            <div className="dg-gantt-row" key={e.id}>
              <div className="dg-gantt-label" title={e.label || e.name}>{e.label || e.name}</div>
              <div className="dg-gantt-track"><div className="dg-gantt-bar" style={{ left: `${(s / total) * 100}%`, width: `${((f - s + 1) / total) * 100}%`, background: colorOf(e.id) }} /></div>
            </div>
          );
        })}
      </div>

      <p className="dg-section-title" style={{ marginTop: 28 }}>Frecuencia de cada entidad, alineada en el calendario</p>
      <p className="dg-section-sub">Una línea por anuncio, cada una en su propia fila, compartiendo el mismo calendario de abajo. <b>Cómo leerla:</b> una frecuencia que sube sin parar indica que el anuncio le está llegando una y otra vez a las mismas personas; cruza esto con el CTR de su gráfica para ver si ya se cansaron.</p>
      {entities.map((e) => <FacetRow key={e.id} e={e} dates={dates} color={colorOf(e.id)} />)}
      <AxisRow dates={dates} />

      <DiagAiPair
        kind="línea de tiempo de entrega (cuándo estuvo activa cada entidad) + frecuencia diaria de todas, comparadas entre sí en el mismo calendario"
        save={{ sectionId: `diag-linea|${entities.map((e) => e.id).join('+')}`, period: { since, until }, sectionTitle: 'Diagnóstico: línea de tiempo y frecuencia' }}
        payload={{
          tipo: 'línea de tiempo y frecuencia comparada',
          periodo: { since, until },
          fechas: dates,
          entidades: entities.map((e) => ({
            nombre: e.label || e.name, conjunto: e.adset_name, campaña: e.campaign_name, inicio: e.inicio, fin: e.fin,
            totales: e.totales, frecuencia_diaria: e.series.frecuencia, costo_resultado_diario: e.series.costo_resultado,
          })),
        }}
      />
    </section>
  );
}

// ------------------------------------------------------------------
// Diagnóstico de ANUNCIOS de las campañas seleccionadas en el Dashboard
// (las mismas 1 a 3 campañas y el mismo rango de fechas). La seleccion
// de campañas se hace solo en el Dashboard; aqui se refleja sola.
// ------------------------------------------------------------------
type SelectedCampaign = { id: string; name: string };

export default function DiagnosticoPanel({
  since, until, setSince, setUntil, campaigns, active, dashboardLoading, accountId = '', accountName = '',
}: {
  accountId?: string;              // cuenta publicitaria elegida en el header
  accountName?: string;
  since: string; until: string; setSince: (v: string) => void; setUntil: (v: string) => void;
  campaigns: SelectedCampaign[];   // campañas elegidas en el Dashboard
  active: boolean;                 // la pestaña Diagnóstico esta visible
  dashboardLoading: boolean;       // el Dashboard aun esta cargando sus campañas
}) {
  const [dates, setDates] = useState<string[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loaded, setLoaded] = useState<{ since: string; until: string; key: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const campaignIds = useMemo(() => campaigns.map((c) => c.id).filter(Boolean), [campaigns]);
  const campaignKey = `${accountId}|${campaignIds.join(',')}`;

  const load = useCallback(async (s: string, u: string, ids: string[], acc: string) => {
    if (ids.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights/daily?since=${s}&until=${u}&level=ad&campaign_ids=${ids.join(',')}${acc ? `&account=${acc}` : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al consultar Meta.');
      const list: Entity[] = json.entities || [];
      const seen: Record<string, number> = {};
      list.forEach((e) => { seen[e.name] = (seen[e.name] || 0) + 1; });
      list.forEach((e) => { e.label = seen[e.name] > 1 && e.adset_name ? `${e.name} · ${e.adset_name}` : e.name; });
      setDates(json.dates || []);
      setEntities(list);
      setLoaded({ since: s, until: u, key: `${acc}|${ids.join(',')}` });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Se recarga sola cuando la pestaña esta visible y cambian las campañas
  // seleccionadas en el Dashboard (no consulta a Meta mientras esta oculta).
  useEffect(() => {
    if (!active || campaignIds.length === 0) return;
    if (loaded && loaded.key === campaignKey) return;
    load(since, until, campaignIds, accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, campaignKey]);

  // Orden de las tarjetas = orden de las campañas en el Dashboard.
  const visible = useMemo(
    () => entities.filter((e) => e.campaign_id && campaignIds.includes(e.campaign_id)),
    [entities, campaignKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const colorOf = useCallback((id: string) => {
    const i = visible.findIndex((e) => e.id === id);
    return ENTITY_COLORS[(i < 0 ? 0 : i) % ENTITY_COLORS.length];
  }, [visible]);

  // Nombres repetidos en distintos conjuntos (el caso "daniela"): con la
  // API cada tarjeta ya es un anuncio distinto por ID, pero se avisa
  // para que nadie los confunda al leer.
  const repeatedNames = useMemo(() => {
    const count: Record<string, Set<string>> = {};
    visible.forEach((e) => { (count[e.name] ||= new Set()).add(e.adset_id || ''); });
    return Object.entries(count).filter(([, s]) => s.size > 1).map(([n, s]) => ({ name: n, adsets: s.size }));
  }, [visible]);

  // Una seccion por campaña seleccionada, en el mismo orden del Dashboard.
  const groups = useMemo(() => campaigns.map((c) => ({
    id: c.id,
    title: `Campaña — ${c.name}`,
    items: visible.filter((e) => e.campaign_id === c.id),
  })), [campaigns, visible]);

  const stale = loaded && (loaded.since !== since || loaded.until !== until);

  return (
    <AccountNameCtx.Provider value={{ id: accountId, name: accountName }}>
    <div className="dg-root">
      <header className="dg-header">
        <p className="dg-brand">{PANEL_BRAND}{accountName ? ` · ${accountName}` : ''}</p>
        <h1>Comportamiento de anuncios{loaded ? ` — ${fmtLongRange(loaded.since, loaded.until)}` : ''}</h1>
        <p className="dg-lead">Anuncios de las campañas que elegiste en el Dashboard, con el mismo rango de fechas. Cada gráfico muestra únicamente los días en que ese anuncio estuvo activo. Todo indexado 0-100 para comparar en el mismo eje — el tooltip muestra el valor real. Las franjas marcan días sin ninguna fila de datos de Meta (posible pausa o corte de entrega).</p>

        <div className="dg-controls">
          <div className="dg-control"><label>Fecha inicial</label><input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></div>
          <div className="dg-control"><label>Fecha final</label><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
          <div className="dg-control dg-campaigns">
            <label>Campañas (se eligen en el Dashboard)</label>
            <div className="dg-chips">
              {campaigns.length === 0
                ? <span className="dg-chip empty">{dashboardLoading ? 'Cargando campañas…' : 'Ninguna seleccionada'}</span>
                : campaigns.map((c) => <span className="dg-chip" key={c.id} title={c.name}>{c.name}</span>)}
            </div>
          </div>
          <button className="dg-btn primary" onClick={() => load(since, until, campaignIds, accountId)} disabled={loading || campaignIds.length === 0}>
            {loading ? 'Consultando…' : stale ? 'Consultar nuevas fechas' : 'Consultar'}
          </button>
        </div>

        <div className="dg-research-box">
          <b>Orden de lectura (según media buyers profesionales):</b> primero el resultado de negocio, después la eficiencia, y al final el contexto de entrega. Por eso <b>Costo por resultado brilla más fuerte</b> que el resto. Haz clic en una métrica de la leyenda de cualquier gráfica para ocultarla o mostrarla.
        </div>

        <div className="dg-glossary">
          <p className="dg-glossary-title">Qué indica cada métrica</p>
          {TIER_LABELS.map((label, tier) => (
            <div className="dg-glossary-tier" key={label}>
              <span className="dg-tier-label">{label}</span>
              <div className="dg-glossary-grid">
                {METRICS.filter((m) => m.tier === tier).map((m) => (
                  <div className="dg-metric" key={m.key}>
                    <div className="dg-metric-name">
                      <span className={`dg-swatch ${tier === 0 ? 'glow-strong' : tier === 1 ? 'glow-mid' : ''}`} style={{ background: m.color, color: m.color }} />
                      {m.label}
                    </div>
                    <div className="dg-metric-desc">{m.desc}</div>
                    <div className="dg-metric-read">{m.read}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <details className="dg-combos" open>
          <summary>Cómo leer las métricas juntas — combinaciones típicas</summary>
          <div className="dg-combos-grid">
            {COMBOS.map((c) => (
              <div className="dg-combo" key={c.when}><b>{c.when}</b><span>{c.means}</span></div>
            ))}
          </div>
        </details>

        {repeatedNames.length > 0 && (
          <div className="dg-warning-box">
            <b>Ojo con los nombres repetidos:</b> {repeatedNames.map((r) => `"${r.name}" (en ${r.adsets} conjuntos)`).join(', ')}. Cada tarjeta es un anuncio distinto según su ID de Meta — se muestra el conjunto debajo del nombre para no mezclarlos.
          </div>
        )}
      </header>

      {error && <div className="dg-error">{error}</div>}

      {campaigns.length === 0 ? (
        <div className="dg-empty">{dashboardLoading ? 'Cargando las campañas del Dashboard…' : 'Elige de 1 a 3 campañas en la pestaña Dashboard para ver el diagnóstico de sus anuncios.'}</div>
      ) : loading && visible.length === 0 ? (
        <div className="dg-empty">Consultando la serie diaria de los anuncios en Meta…</div>
      ) : !loading && loaded && visible.length === 0 ? (
        <div className="dg-empty">Los anuncios de estas campañas no tuvieron entrega en este rango de fechas.</div>
      ) : (
        <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity .2s' }}>
          {groups.map((g) => (
            <section key={g.id}>
              <p className="dg-group-title">{g.title} · {g.items.length} anuncio{g.items.length !== 1 ? 's' : ''}</p>
              {g.items.length === 0
                ? <div className="dg-empty" style={{ marginBottom: 18 }}>Ningún anuncio de esta campaña tuvo entrega en el rango.</div>
                : g.items.map((e) => <EntityCard key={`${e.level}-${e.id}`} e={e} dates={dates} since={loaded?.since || since} until={loaded?.until || until} />)}
            </section>
          ))}

          {visible.length > 0 && (
            <>
              <RetentionCard entities={visible} colorOf={colorOf} since={loaded?.since || since} until={loaded?.until || until} />
              <TimelineCard entities={visible} dates={dates} colorOf={colorOf} since={loaded?.since || since} until={loaded?.until || until} />
            </>
          )}

          <p className="dg-note">Metodología: todos los valores vienen directo de Meta, día por día (time_increment=1), a nivel de anuncio — Meta calcula alcance, frecuencia y CPM de cada anuncio, no se suman entre anuncios. CTR = CTR (todos los clics) de Meta. Resultados y costo por resultado se leen igual que en el Dashboard (campo "conversions" de Meta primero). Retención de video agregada del período. No se aplican semáforos ni umbrales automáticos.</p>
        </div>
      )}
    </div>
    </AccountNameCtx.Provider>
  );
}
