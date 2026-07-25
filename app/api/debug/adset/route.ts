import { NextRequest, NextResponse } from 'next/server';

// Ruta temporal de diagnostico: muestra EXACTAMENTE lo que Meta devuelve
// para un conjunto de anuncios (optimization_goal, promoted_object, y el
// pixel/dataset asociado). La usamos para mapear el evento de conversion
// correctamente en vez de adivinar. Se puede borrar despues de usarla.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const adsetId = searchParams.get('id');

  if (!adsetId) {
    return NextResponse.json({ error: 'Falta el parametro ?id=<adset_id>' }, { status: 400 });
  }

  const token = process.env.META_SYSTEM_USER_TOKEN;
  const version = process.env.META_API_VERSION || 'v19.0';

  const url = new URL(`https://graph.facebook.com/${version}/${adsetId}`);
  url.searchParams.set(
    'fields',
    'name,optimization_goal,promoted_object,destination_type,billing_event'
  );
  url.searchParams.set('access_token', token!);

  const res = await fetch(url.toString());
  const json = await res.json();

  return NextResponse.json(json, { status: res.ok ? 200 : 500 });
}
