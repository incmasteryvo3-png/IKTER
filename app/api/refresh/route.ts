import { NextResponse } from 'next/server';
import { runMetaSync } from '@/lib/syncMeta';

export const maxDuration = 60;

// Llamado por el boton "Actualizar ahora" del dashboard.
// No requiere secreto porque no acepta parametros sensibles del usuario:
// siempre sincroniza la misma cuenta configurada en las variables de entorno.
// Nota: en Fase 2 (multi-cliente), esta ruta debe validar la sesion del
// usuario logueado y sincronizar solo la cuenta que le corresponde.
export async function POST() {
  try {
    const result = await runMetaSync();
    return NextResponse.json({ ok: true, ...result, synced_at: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
