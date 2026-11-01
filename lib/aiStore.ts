// ============================================================
// Guardado de los analisis de IA en Supabase (tabla ai_summaries).
// Cada analisis queda con:
//   - section_key: QUE seccion/grafica es (cuenta + tipo + ids), estable
//     entre dias, para poder ver el historial de esa misma seccion.
//   - data_hash: huella de los DATOS exactos analizados. Si vuelves a la
//     misma vista con los mismos datos, se muestra el guardado y no se
//     le vuelve a pagar a la IA.
// Requiere correr sql/migracion_v06.sql (agrega esas columnas).
// ============================================================
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

export type SaveInput = {
  provider: 'gemini' | 'claude';
  model: string;
  section_key?: string | null;
  data_hash?: string | null;
  data: unknown;
  period?: { since?: string; until?: string } | null;
  account?: string | null;
  title?: string | null;
  summary_md: string;
};

export function hashData(data: unknown) {
  return createHash('sha256').update(JSON.stringify(data ?? null)).digest('hex');
}

/** Guarda el analisis. Nunca lanza error: si falla, solo lo registra. */
export async function saveAnalysis(input: SaveInput): Promise<string | null> {
  if (!input.section_key) return null;
  try {
    const db = supabaseAdmin();
    let adAccountUuid: string | null = null;
    if (input.account) {
      const { data } = await db.from('ad_accounts').select('id').eq('meta_account_id', input.account).maybeSingle();
      adAccountUuid = (data as any)?.id || null;
    }
    const today = new Date().toISOString().slice(0, 10);
    const generatedAt = new Date().toISOString();
    const { error } = await db.from('ai_summaries').insert({
      ad_account_id: adAccountUuid,
      meta_account_id: input.account || null,
      period_start: validDate(input.period?.since) || today,
      period_end: validDate(input.period?.until) || today,
      summary_md: input.summary_md,
      model: input.model,
      provider: input.provider,
      section_key: input.section_key.slice(0, 500),
      data_hash: (input.data_hash && /^[a-f0-9]{64}$/.test(input.data_hash)) ? input.data_hash : hashData(input.data),
      title: input.title?.slice(0, 300) || null,
      generated_at: generatedAt,
    });
    if (error) {
      console.error('No se pudo guardar el analisis (¿corriste sql/migracion_v06.sql?):', error.message);
      return null;
    }
    return generatedAt;
  } catch (e: any) {
    console.error('Error guardando analisis:', e?.message);
    return null;
  }
}

function validDate(v?: string) {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export type SavedRow = {
  provider: string;
  section_key: string;
  data_hash: string;
  summary_md: string;
  generated_at: string;
  period_start: string;
  period_end: string;
};

/** Ultimos analisis guardados (hasta 6 por seccion y por IA). */
export async function getSaved(keys: string[]): Promise<Record<string, SavedRow[]>> {
  const out: Record<string, SavedRow[]> = {};
  if (!keys.length) return out;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('ai_summaries')
    .select('provider, section_key, data_hash, summary_md, generated_at, period_start, period_end')
    .in('section_key', keys)
    .order('generated_at', { ascending: false })
    .limit(Math.min(1000, keys.length * 12));
  if (error) throw new Error(error.message);
  for (const row of (data || []) as SavedRow[]) {
    const k = `${row.provider}::${row.section_key}`;
    (out[k] ||= []);
    if (out[k].length < 6) out[k].push(row);
  }
  return out;
}
