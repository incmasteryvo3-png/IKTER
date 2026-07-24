import { NextRequest, NextResponse } from 'next/server';
import { generateAnthropicAnalysis } from '@/lib/anthropic';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.data) {
      return NextResponse.json({ error: 'Falta el campo "data" en la solicitud.' }, { status: 400 });
    }
    const summary_md = await generateAnthropicAnalysis(body.data, body.prompt);
    return NextResponse.json({ ok: true, summary_md });
  } catch (err: any) {
    console.error('Error en /api/analyze/claude:', err);
    return NextResponse.json({ error: err?.message || 'Error al generar el analisis con Claude.' }, { status: 500 });
  }
}
