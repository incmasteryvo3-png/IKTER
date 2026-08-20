import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

// Herramienta de UNA SOLA VEZ para ver, contra un anuncio real, como
// Meta estructura la creatividad en tu cuenta especifica - antes de
// seguir adivinando en que campo viene el link de la landing real.
//
// Uso: /api/diagnostics/meta-creative?adId=XXXX (el ID lo sacas de la
// URL de Meta Ads Manager cuando tienes el anuncio abierto, o de la
// columna "Anuncio" en /api/insights).
//
// Protegido con CRON_SECRET, igual que el resto de diagnosticos.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const adId = req.nextUrl.searchParams.get('adId');
  if (!adId) {
    return NextResponse.json({ error: 'Falta ?adId=... en la URL' }, { status: 400 });
  }

  const token = process.env.META_SYSTEM_USER_TOKEN;
  const apiVersion = process.env.META_API_VERSION || 'v19.0';
  if (!token) {
    return NextResponse.json({ error: 'Falta META_SYSTEM_USER_TOKEN en el servidor.' }, { status: 500 });
  }

  // Se pide la creatividad COMPLETA, sin limitar a subcampos
  // especificos, para ver toda la estructura real de una vez - asi no
  // hay que ir adivinando y pidiendo de nuevo cada campo por separado.
  const url = `https://graph.facebook.com/${apiVersion}/${adId}?fields=name,creative{object_story_spec,asset_feed_spec,effective_object_story_id,link_url,url_tags}&access_token=${token}`;

  const res = await fetch(url);
  const body = await res.text();

  return new NextResponse(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
