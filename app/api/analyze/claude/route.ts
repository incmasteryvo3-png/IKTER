import { NextRequest, NextResponse } from 'next/server';
import { generateAnthropicAnalysis } from '@/lib/anthropic';
import { saveAnalysis } from '@/lib/aiStore';

export const maxDuration = 60;

// Mismo contrato que /api/analyze/gemini (ver comentario alli).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.data) {
      return NextResponse.json({ error: 'Falta el campo "data" en la solicitud.' }, { status: 400 });
    }
    const summary_md = await generateAnthropicAnalysis(body.data, body.prompt);
    const saved_at = await saveAnalysis({
      provider: 'claude', model: 'claude-sonnet-5', summary_md, data: body.data,
      section_key: body.section_key, data_hash: body.data_hash, period: body.period, account: body.account, title: body.title,
    });
    return NextResponse.json({ ok: true, summary_md, saved_at });
  } catch (err: any) {
    console.error('Error en /api/analyze/claude:', err);
    return NextResponse.json({ error: err?.message || 'Error al generar el analisis con Claude.' }, { status: 500 });
  }
}
