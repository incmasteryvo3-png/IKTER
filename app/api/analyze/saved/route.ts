import { NextRequest, NextResponse } from 'next/server';
import { getSaved } from '@/lib/aiStore';

export const dynamic = 'force-dynamic';

// POST { keys: string[] } -> ultimos analisis guardados de esas secciones,
// agrupados por "proveedor::section_key". Una sola llamada por pantalla.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const keys: string[] = Array.isArray(body?.keys) ? body.keys.filter((k: any) => typeof k === 'string').slice(0, 120) : [];
    const saved = await getSaved(keys);
    return NextResponse.json({ ok: true, saved });
  } catch (err: any) {
    // Si la migracion aun no se corrio, la interfaz sigue funcionando sin historial.
    return NextResponse.json({ ok: false, saved: {}, error: err?.message }, { status: 200 });
  }
}
