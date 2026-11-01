// ============================================================
// Resumen semanal por correo.
// Compara la SEMANA PASADA (lunes a domingo, hora de Colombia) contra la
// semana anterior, para cada cuenta publicitaria, y arma un correo con:
//   - totales de la cuenta (gasto, resultados, costo por resultado, CTR)
//   - anuncios que conviene escalar
//   - anuncios que subieron su costo por resultado (o dejaron de convertir)
//   - anuncios con señales de fatiga (CTR cae + frecuencia o CPM suben)
//   - anuncios que gastan sin traer resultados
//   - un párrafo corto escrito por Gemini (opcional, en tono de profesor)
// Se envía con Resend (RESEND_API_KEY) a todos los usuarios registrados
// en Supabase (Authentication → Users).
// ============================================================
import { fetchMetaInsights } from '@/lib/meta';
import { getAdAccounts, type AdAccount } from '@/lib/accounts';
import { supabaseAdmin } from '@/lib/supabase';

type Row = Awaited<ReturnType<typeof fetchMetaInsights>>[number];

type AdStat = {
  id: string; name: string;
  spend: number; results: number; cpr: number | null;
  impressions: number; reach: number; clicks: number;
  ctr: number | null; freq: number | null; cpm: number | null;
};
type Item = { name: string; detail: string };
export type AccountReport = {
  account: AdAccount;
  totals: { spend: number; results: number; cpr: number | null; ctr: number | null };
  prevTotals: { spend: number; results: number; cpr: number | null; ctr: number | null };
  escalar: Item[]; subioCosto: Item[]; fatiga: Item[]; sinResultados: Item[];
  ai: string | null;
  error?: string;
};
export type WeeklyReport = { week: { since: string; until: string }; prev: { since: string; until: string }; accounts: AccountReport[] };

// ---- Fechas (Colombia, UTC-5 sin horario de verano) ----
function bogotaToday(): Date {
  const now = new Date(Date.now() - 5 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function addDays(d: Date, n: number) { return new Date(d.getTime() + n * 86400_000); }
function iso(d: Date) { return d.toISOString().slice(0, 10); }

export function lastFullWeek() {
  const today = bogotaToday();
  const dow = today.getUTCDay(); // 0 domingo ... 1 lunes
  const end = addDays(today, -(dow === 0 ? 7 : dow)); // domingo anterior
  const start = addDays(end, -6);
  return {
    week: { since: iso(start), until: iso(end) },
    prev: { since: iso(addDays(start, -7)), until: iso(addDays(end, -7)) },
  };
}

// ---- Cálculos ----
function toStat(r: Row): AdStat {
  return {
    id: r.level_id, name: r.level_name,
    spend: r.spend, results: r.results,
    cpr: r.results > 0 ? (r.cost_per_result ?? r.spend / r.results) : null,
    impressions: r.impressions, reach: r.reach, clicks: r.clicks,
    ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
    freq: r.reach > 0 ? r.impressions / r.reach : null,
    cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null,
  };
}
function totalsOf(list: AdStat[]) {
  const spend = list.reduce((s, a) => s + a.spend, 0);
  const results = list.reduce((s, a) => s + a.results, 0);
  const impressions = list.reduce((s, a) => s + a.impressions, 0);
  const clicks = list.reduce((s, a) => s + a.clicks, 0);
  return { spend, results, cpr: results > 0 ? spend / results : null, ctr: impressions > 0 ? (clicks / impressions) * 100 : null };
}
const money = (v: number) => `$${v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`;
const change = (cur: number, prev: number) => (prev ? ((cur - prev) / prev) * 100 : 0);

function analyze(cur: AdStat[], prev: AdStat[]) {
  const prevById = new Map(prev.map((a) => [a.id, a]));
  const t = totalsOf(cur);
  const minSpend = Math.max(5, t.spend * 0.03);

  const escalar = cur
    .filter((a) => a.results >= 2 && a.cpr !== null && a.spend >= minSpend && (t.cpr === null || a.cpr <= t.cpr))
    .sort((a, b) => (a.cpr! - b.cpr!))
    .slice(0, 3)
    .map((a) => {
      const p = prevById.get(a.id);
      const trend = p?.cpr ? ` (${pct(change(a.cpr!, p.cpr))} vs semana anterior)` : '';
      return { name: a.name, detail: `${a.results} resultados a ${money(a.cpr!)} c/u${trend}, por debajo del promedio de la cuenta.` };
    });

  const subioCosto: Item[] = [];
  for (const a of cur) {
    const p = prevById.get(a.id);
    if (!p || a.spend < minSpend) continue;
    if (a.cpr !== null && p.cpr !== null && a.cpr >= p.cpr * 1.25) {
      subioCosto.push({ name: a.name, detail: `Costo por resultado pasó de ${money(p.cpr)} a ${money(a.cpr)} (${pct(change(a.cpr, p.cpr))}).` });
    } else if (a.results === 0 && p.results > 0) {
      subioCosto.push({ name: a.name, detail: `Dejó de convertir: ${p.results} resultados la semana anterior, 0 esta semana con ${money(a.spend)} gastados.` });
    }
  }

  const fatiga: Item[] = [];
  for (const a of cur) {
    const p = prevById.get(a.id);
    if (!p || a.impressions < 1000 || p.impressions < 1000 || a.ctr === null || p.ctr === null) continue;
    const ctrDrop = change(a.ctr, p.ctr);
    const freqUp = a.freq && p.freq ? change(a.freq, p.freq) : 0;
    const cpmUp = a.cpm && p.cpm ? change(a.cpm, p.cpm) : 0;
    if (ctrDrop <= -20 && (freqUp >= 10 || cpmUp >= 15)) {
      const parts = [`CTR ${p.ctr.toFixed(2)}% → ${a.ctr.toFixed(2)}%`];
      if (freqUp >= 10) parts.push(`frecuencia ${p.freq!.toFixed(2)} → ${a.freq!.toFixed(2)}`);
      if (cpmUp >= 15) parts.push(`CPM ${money(p.cpm!)} → ${money(a.cpm!)}`);
      fatiga.push({ name: a.name, detail: `${parts.join(', ')}. La gente ya lo vio y le está haciendo menos clic: momento de renovar el creativo.` });
    }
  }

  const sinResultados = cur
    .filter((a) => a.results === 0 && a.spend >= minSpend * 2 && !subioCosto.some((s) => s.name === a.name))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3)
    .map((a) => ({ name: a.name, detail: `${money(a.spend)} gastados sin ningún resultado.` }));

  return { totals: t, escalar, subioCosto: subioCosto.slice(0, 3), fatiga: fatiga.slice(0, 3), sinResultados };
}

// ---- Párrafo de IA (Gemini, sin búsqueda web para que sea rápido) ----
async function aiParagraph(report: Omit<AccountReport, 'ai'>, week: { since: string; until: string }): Promise<string | null> {
  if ((process.env.WEEKLY_REPORT_AI || 'on').toLowerCase() === 'off' || !process.env.GEMINI_API_KEY) return null;
  const prompt = `Eres un media buyer senior que también enseña. Escribe UN párrafo de 3 a 4 frases, en español claro
y sin jerga sin explicar, para el dueño de la cuenta publicitaria "${report.account.name}", resumiendo la semana
${week.since} a ${week.until} y diciendo la acción más importante para esta semana. Usa solo estos datos, no inventes:
${JSON.stringify({ totales: report.totals, semana_anterior: report.prevTotals, escalar: report.escalar, subio_costo: report.subioCosto, fatiga: report.fatiga, sin_resultados: report.sinResultados })}
Responde solo el párrafo, sin títulos ni viñetas.`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const json = await res.json();
    const text = (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join(' ').trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function buildWeeklyReport(): Promise<WeeklyReport> {
  const { week, prev } = lastFullWeek();
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  const accounts = getAdAccounts();

  const reports = await Promise.all(accounts.map(async (account): Promise<AccountReport> => {
    try {
      const [cur, old] = await Promise.all([
        fetchMetaInsights({ adAccountId: account.id, token, level: 'ad', ...week }),
        fetchMetaInsights({ adAccountId: account.id, token, level: 'ad', ...prev }),
      ]);
      const curStats = cur.map(toStat), oldStats = old.map(toStat);
      const a = analyze(curStats, oldStats);
      const base = { account, totals: a.totals, prevTotals: totalsOf(oldStats), escalar: a.escalar, subioCosto: a.subioCosto, fatiga: a.fatiga, sinResultados: a.sinResultados };
      return { ...base, ai: await aiParagraph(base, week) };
    } catch (e: any) {
      const empty = { spend: 0, results: 0, cpr: null, ctr: null };
      return { account, totals: empty, prevTotals: empty, escalar: [], subioCosto: [], fatiga: [], sinResultados: [], ai: null, error: e?.message || 'Error al consultar Meta' };
    }
  }));

  return { week, prev, accounts: reports };
}

// ---- Correo HTML (estilos en línea para que se vea bien en Gmail/Outlook) ----
function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtRange(r: { since: string; until: string }) {
  const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${new Date(`${r.since}T00:00:00Z`).toLocaleDateString('es-CO', o)} – ${new Date(`${r.until}T00:00:00Z`).toLocaleDateString('es-CO', { ...o, year: 'numeric' })}`;
}

function kpi(label: string, cur: string, delta: string | null, good: boolean | null) {
  const color = good === null ? '#6b6570' : good ? '#1c7a44' : '#cc4f39';
  return `<td style="padding:10px 12px;background:#faf7fb;border-radius:8px;" width="25%">
    <div style="font-size:11px;color:#6b6570;text-transform:uppercase;letter-spacing:.4px;">${label}</div>
    <div style="font-size:18px;font-weight:700;color:#212121;margin-top:2px;">${cur}</div>
    ${delta ? `<div style="font-size:11px;color:${color};margin-top:2px;">${delta} vs semana anterior</div>` : ''}
  </td>`;
}
function list(title: string, color: string, items: Item[], explain: string) {
  if (!items.length) return '';
  return `<div style="margin-top:16px;">
    <div style="font-size:13px;font-weight:700;color:${color};">${title}</div>
    <div style="font-size:11.5px;color:#6b6570;margin:2px 0 6px;">${explain}</div>
    ${items.map((i) => `<div style="font-size:13px;color:#212121;padding:6px 0;border-top:1px solid #eee;"><b>${esc(i.name)}</b><br/><span style="color:#444;">${esc(i.detail)}</span></div>`).join('')}
  </div>`;
}

export function renderWeeklyEmail(r: WeeklyReport, siteUrl: string): { subject: string; html: string } {
  const sections = r.accounts.map((a) => {
    if (a.error) {
      return `<div style="margin-top:24px;padding:16px;border:1px solid #e6dfeb;border-radius:12px;"><div style="font-size:16px;font-weight:700;">${esc(a.account.name)}</div><div style="color:#cc4f39;font-size:13px;margin-top:6px;">No se pudo consultar esta cuenta: ${esc(a.error)}</div></div>`;
    }
    const t = a.totals, p = a.prevTotals;
    const nothing = !a.escalar.length && !a.subioCosto.length && !a.fatiga.length && !a.sinResultados.length;
    return `<div style="margin-top:24px;padding:18px;border:1px solid #e6dfeb;border-radius:12px;">
      <div style="font-size:16px;font-weight:700;color:#551868;">${esc(a.account.name)}</div>
      <table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="margin-top:8px;"><tr>
        ${kpi('Gasto', money(t.spend), p.spend ? pct(change(t.spend, p.spend)) : null, null)}
        ${kpi('Resultados', String(t.results), p.results ? pct(change(t.results, p.results)) : null, p.results ? t.results >= p.results : null)}
        ${kpi('Costo por resultado', t.cpr !== null ? money(t.cpr) : '—', t.cpr !== null && p.cpr ? pct(change(t.cpr, p.cpr)) : null, t.cpr !== null && p.cpr ? t.cpr <= p.cpr : null)}
        ${kpi('CTR', t.ctr !== null ? `${t.ctr.toFixed(2)}%` : '—', t.ctr !== null && p.ctr ? pct(change(t.ctr, p.ctr)) : null, t.ctr !== null && p.ctr ? t.ctr >= p.ctr : null)}
      </tr></table>
      ${a.ai ? `<div style="margin-top:14px;padding:12px 14px;background:#fff8ec;border-left:3px solid #FFA51F;font-size:13px;line-height:1.55;color:#333;">${esc(a.ai)}</div>` : ''}
      ${list('✅ Conviene escalar', '#1c7a44', a.escalar, 'Traen resultados más baratos que el promedio de la cuenta.')}
      ${list('⚠️ Subió su costo por resultado', '#cc4f39', a.subioCosto, 'Cada resultado salió bastante más caro que la semana anterior (o dejaron de convertir).')}
      ${list('😴 Señales de fatiga', '#cc8318', a.fatiga, 'Menos gente hace clic mientras se repite ante las mismas personas o se encarece mostrarlo.')}
      ${list('💸 Gastan sin resultados', '#7A2394', a.sinResultados, 'Revisa si la página o la oferta están funcionando, o si conviene pausarlos.')}
      ${nothing ? '<div style="margin-top:14px;font-size:13px;color:#6b6570;">Semana estable: ningún anuncio cumplió las condiciones de alerta ni de escala.</div>' : ''}
    </div>`;
  }).join('');

  const html = `<!doctype html><html><body style="margin:0;background:#F6F5F4;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:16px;"><tr><td style="padding:28px;">
    <div style="font-size:12px;letter-spacing:.08em;color:#7A2394;font-weight:700;">MASTERY · RESUMEN SEMANAL</div>
    <div style="font-size:22px;font-weight:700;color:#212121;margin-top:4px;">Semana del ${fmtRange(r.week)}</div>
    <div style="font-size:13px;color:#6b6570;margin-top:4px;">Comparada contra ${fmtRange(r.prev)}. Datos de Meta Ads, por cuenta publicitaria.</div>
    ${sections}
    <div style="text-align:center;margin-top:26px;">
      <a href="${siteUrl}" style="display:inline-block;background:#7A2394;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px;">Abrir IKTER</a>
    </div>
    <div style="font-size:11px;color:#9a9a9a;margin-top:22px;line-height:1.5;">Recibes este correo porque tienes usuario en IKTER. Las alertas usan reglas simples (cambios de 20–25% semana contra semana, con un gasto mínimo); confírmalas en la pestaña Diagnóstico antes de tomar decisiones.</div>
  </td></tr></table></td></tr></table></body></html>`;

  return { subject: `Resumen semanal de anuncios · ${fmtRange(r.week)}`, html };
}

// ---- Destinatarios y envío ----
export async function getRecipients(): Promise<string[]> {
  const override = (process.env.WEEKLY_REPORT_TO || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (override.length) return override;
  const exclude = new Set((process.env.WEEKLY_REPORT_EXCLUDE || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const db = supabaseAdmin();
  const emails: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`No se pudo leer la lista de usuarios: ${error.message}`);
    for (const u of data.users) {
      const confirmed = (u as any).email_confirmed_at || (u as any).confirmed_at;
      const banned = (u as any).banned_until && new Date((u as any).banned_until) > new Date();
      if (u.email && confirmed && !banned && !exclude.has(u.email.toLowerCase())) emails.push(u.email.toLowerCase());
    }
    if (data.users.length < 200) break;
  }
  return Array.from(new Set(emails));
}

export async function sendEmails(to: string[], subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error('Faltan RESEND_API_KEY o EMAIL_FROM en Vercel.');
  // Un correo por persona (nadie ve los correos de los demás), en lotes de 100.
  let sent = 0;
  for (let i = 0; i < to.length; i += 100) {
    const batch = to.slice(i, i + 100).map((email) => ({ from, to: [email], subject, html }));
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Resend respondió ${res.status}: ${txt.slice(0, 300)}`);
    }
    sent += batch.length;
  }
  return sent;
}
