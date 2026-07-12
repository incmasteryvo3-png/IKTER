import { NextRequest, NextResponse } from 'next/server';
import { generateAnalysis } from '@/lib/gemini';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  return runAnalysis();
}

// Llamado por el boton "Generar analisis" del dashboard (sin secreto,
// igual que /api/refresh: no acepta parametros sensibles del usuario).
export async function POST() {
  return runAnalysis();
}


async function runAnalysis() {
  const db = supabaseAdmin();

  // Trae el snapshot mas reciente por cada nivel/entidad
  const { data: snapshots, error } = await db
    .from('insight_snapshots')
    .select('*')
    .order('fetched_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!snapshots || snapshots.length === 0) {
    return NextResponse.json({ error: 'Aun no hay datos sincronizados. Ejecuta /api/sync-meta primero.' }, { status: 400 });
  }

  // Se consolida por nivel para no mandarle a Gemini datos redundantes
  const consolidated = {
    campañas: snapshots.filter((s) => s.level === 'campaign'),
    conjuntos_de_anuncios: snapshots.filter((s) => s.level === 'adset'),
    anuncios: snapshots.filter((s) => s.level === 'ad'),
  };

  const summaryMd = await generateAnalysis(consolidated);

  const periodEnd = snapshots[0].date_stop;
  const periodStart = snapshots[0].date_start;

  const { error: saveErr } = await db.from('ai_summaries').insert({
    ad_account_id: snapshots[0].ad_account_id,
    period_start: periodStart,
    period_end: periodEnd,
    summary_md: summaryMd,
  });

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, summary_md: summaryMd });
}
