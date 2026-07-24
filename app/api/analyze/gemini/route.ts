import { NextRequest, NextResponse } from 'next/server';
import { generateAnalysis } from '@/lib/gemini';

export const maxDuration = 60;

// Recibe { data, label } desde el frontend: 'data' es exactamente lo que
// esa tarjeta esta mostrando (comparacion de campañas, un conjunto de
// anuncios especifico, o la tabla de creativos), no algo re-consultado
// de la base de datos. Por eso cada tarjeta analiza justo lo que ves.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.data) {
      return NextResponse.json({ error: 'Falta el campo "data" en la solicitud.' }, { status: 400 });
    }
    const summary_md = await generateAnalysis(body.data, body.prompt);
    return NextResponse.json({ ok: true, summary_md });
  } catch (err: any) {
    console.error('Error en /api/analyze/gemini:', err);
    return NextResponse.json({ error: err?.message || 'Error al generar el analisis con Gemini.' }, { status: 500 });
  }
}
