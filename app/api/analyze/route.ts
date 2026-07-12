import { NextRequest, NextResponse } from 'next/server';
import { generateAnalysis } from '@/lib/gemini';
import { supabaseAdmin } from '@/lib/supabase';

// Le da hasta 60 segundos a la funcion (Gemini puede tardar mas de los
// 10 segundos por defecto de Vercel, sobre todo con muchos anuncios).
export const maxDuration = 60;

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
  try {
    const db = supabaseAdmin();

    const { data: snapshots, error } = await db
      .from('insight_snapshots')
      .select('*')
      .order('fetched_at', { ascending: false })
      .limit(200);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!snapshots || snapshots.length === 0) {
      return NextResponse.json(
        { error: 'Aún no hay datos sincronizados. Presiona "Actualizar ahora" primero.' },
        { status: 400 }
      );
    }

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
      model: 'gemini-2.5-flash',
    });

    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, summary_md: summaryMd });
  } catch (err: any) {
    // Esto es lo que faltaba: sin este catch, si Gemini fallaba (API key
    // invalida, timeout, error de red), la funcion se caia sin devolver
    // JSON valido, y el navegador mostraba "Unexpected end of JSON input".
    console.error('Error en /api/analyze:', err);
    return NextResponse.json(
      { error: err?.message || 'Error inesperado al generar el analisis con Gemini.' },
      { status: 500 }
    );
  }
}
