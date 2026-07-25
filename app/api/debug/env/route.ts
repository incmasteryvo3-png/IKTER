import { NextResponse } from 'next/server';

// Ruta temporal de diagnostico: NO expone la clave completa, solo su
// longitud y unos pocos caracteres del inicio/final - suficiente para
// confirmar si Vercel esta inyectando lo que creemos que esta inyectando,
// sin arriesgar la clave. Borrar despues de usarla.
export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY || '';

  return NextResponse.json({
    exists: key.length > 0,
    length: key.length,
    starts_with: key.slice(0, 12),
    ends_with: key.slice(-6),
    has_leading_or_trailing_whitespace: key !== key.trim(),
    has_quotes: key.includes('"') || key.includes("'"),
    has_newline: key.includes('\n') || key.includes('\r'),
  });
}
