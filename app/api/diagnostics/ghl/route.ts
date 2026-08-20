import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

// Herramienta de UNA SOLA VEZ para verificar, contra un contacto real,
// como GHL nombra los campos de atribucion en tu cuenta especifica -
// antes de confiar en lib/ghl.ts para el backfill masivo.
//
// Uso: /api/diagnostics/ghl?contactId=XXXX (el ID lo sacas de la URL de
// GHL cuando tienes el contacto abierto: .../contacts/detail/ESE_ID)
//
// Protegido con CRON_SECRET para que no quede abierto a cualquiera -
// manda el header Authorization: Bearer <CRON_SECRET> (con Postman,
// Insomnia, o incluso curl desde la terminal).
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const contactId = req.nextUrl.searchParams.get('contactId');
  if (!contactId) {
    return NextResponse.json({ error: 'Falta ?contactId=... en la URL' }, { status: 400 });
  }

  const token = process.env.GHL_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Falta GHL_API_TOKEN en el servidor.' }, { status: 500 });
  }

  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
  });
  const body = await res.text();

  // Se devuelve el JSON crudo tal cual, sin interpretar nada - el
  // objetivo es que lo puedas comparar a ojo contra lo que lib/ghl.ts
  // intenta leer (contact.attributionSource, contact.customFields, etc.)
  return new NextResponse(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
