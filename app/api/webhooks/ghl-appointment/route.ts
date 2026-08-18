import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 30;

// ============================================================
// Recibe UNA cita por llamada, disparado por un Workflow de GHL
// (trigger "Appointment Booked" -> accion "Webhook"). GHL no manda un
// formato fijo predecible en su payload por defecto, asi que en vez de
// adivinarlo, este endpoint espera el JSON EXACTO descrito abajo - tu
// lo armas en el editor de la accion "Webhook" del workflow usando los
// merge-tags que GHL te ofrece ahi mismo (icono de variables / {} en el
// editor del cuerpo de la peticion).
//
// Cuerpo esperado:
// {
//   "appointment_id": "{{appointment.id}}",
//   "contact_id": "{{contact.id}}",
//   "contact_name": "{{contact.name}}",
//   "contact_phone": "{{contact.phone}}",
//   "contact_email": "{{contact.email}}",
//   "appointment_start_at": "{{appointment.start_time}}",
//   "appointment_created_at": "{{appointment.date_added}}",
//   "utm_campaign": "{{contact.utm_campaign}}",   <- campaign_id de Meta
//   "utm_term": "{{contact.utm_term}}",             <- adset_id de Meta
//   "utm_content": "{{contact.utm_content}}",       <- ad_id de Meta
//   "utm_source": "{{contact.utm_source}}",
//   "utm_medium": "{{contact.utm_medium}}"
// }
//
// IMPORTANTE: los merge-tags de arriba (utm_campaign, utm_term, etc.)
// son los que ya confirmamos que existen en tu cuenta para las landings
// planas (coinciden con Utm Campaign / Utm Term / Utm Content que se ven
// en "Detalles de la actividad" de un contacto). Para AIRA y el futuro
// IKTER-demo, si el UTM llega por un campo oculto de formulario en vez
// de la atribucion nativa, el merge-tag deberia ser el mismo siempre
// que el campo del formulario se llame igual (utm_campaign, utm_term,
// utm_content) - confirma esto en el picker de variables del workflow
// antes de dar por bueno el mapeo.
//
// Seguridad: se exige un secreto compartido, para que no cualquiera
// pueda mandarle citas falsas a esta URL. Se manda como header
// "X-Webhook-Secret" en la configuracion de la accion "Webhook" de GHL
// (seccion de headers personalizados).
// ============================================================

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-webhook-secret');
  if (secret !== process.env.GHL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo no es JSON valido' }, { status: 400 });
  }

  if (!body.appointment_id) {
    return NextResponse.json({ error: 'Falta appointment_id en el cuerpo' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db.from('ghl_appointments').upsert(
    {
      ghl_appointment_id: String(body.appointment_id),
      ghl_contact_id: body.contact_id ? String(body.contact_id) : null,
      contact_name: body.contact_name || null,
      contact_phone: body.contact_phone || null,
      contact_email: body.contact_email || null,
      meta_campaign_id: body.utm_campaign || null,
      meta_adset_id: body.utm_term || null,
      meta_ad_id: body.utm_content || null,
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      appointment_start_at: body.appointment_start_at || null,
      appointment_created_at: body.appointment_created_at || null,
      source: 'webhook',
      raw: body,
    },
    { onConflict: 'ghl_appointment_id' }
  );

  if (error) {
    console.error('Error guardando cita de GHL:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
