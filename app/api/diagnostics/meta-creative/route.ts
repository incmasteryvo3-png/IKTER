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

  const adUrl = `https://graph.facebook.com/${apiVersion}/${adId}?fields=name,creative{object_story_spec,asset_feed_spec{link_urls,bodies,titles,images,videos,call_to_action_types},effective_object_story_id,link_url,url_tags}&access_token=${token}`;
  const adRes = await fetch(adUrl);
  const adBody = await adRes.json();

  if (!adRes.ok) {
    return NextResponse.json(adBody, { status: adRes.status });
  }

  // Si la creatividad no tiene object_story_spec pero si trae un
  // effective_object_story_id (publicacion organica de la pagina), se
  // sigue ese hilo automaticamente y se trae la publicacion tambien -
  // asi se ve todo junto de una sola llamada, sin tener que pedir dos
  // diagnosticos por separado.
  const postId = adBody?.creative?.effective_object_story_id;
  let post = null;
  if (postId) {
    const postUrl = `https://graph.facebook.com/${apiVersion}/${postId}?fields=link,message,attachments{url,unshimmed_url,type,title,description,target}&access_token=${token}`;
    const postRes = await fetch(postUrl);
    post = await postRes.json();
  }

  return NextResponse.json({ ad: adBody, post });
}
