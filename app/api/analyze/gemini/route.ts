import { NextRequest, NextResponse } from 'next/server';
import { generateAnalysis } from '@/lib/gemini';
import { saveAnalysis } from '@/lib/aiStore';

export const maxDuration = 60;

// Recibe { data, prompt?, section_key?, data_hash?, period?, account?, title? }
// desde el frontend: 'data' es exactamente lo que esa tarjeta esta
// mostrando. Si viene section_key, el analisis se guarda en Supabase
// (ai_summaries) para poder verlo despues sin volver a pagarlo.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.data) {
      return NextResponse.json({ error: 'Falta el campo "data" en la solicitud.' }, { status: 400 });
    }
    const summary_md = await generateAnalysis(body.data, body.prompt);
    const saved_at = await saveAnalysis({
      provider: 'gemini', model: 'gemini-2.5-flash', summary_md, data: body.data,
      section_key: body.section_key, data_hash: body.data_hash, period: body.period, account: body.account, title: body.title,
    });
    return NextResponse.json({ ok: true, summary_md, saved_at });
  } catch (err: any) {
    console.error('Error en /api/analyze/gemini:', err);
    return NextResponse.json({ error: err?.message || 'Error al generar el analisis con Gemini.' }, { status: 500 });
  }
}
