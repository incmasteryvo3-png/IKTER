import { NextRequest, NextResponse } from 'next/server';
import { fetchGhlAppointments, fetchGhlContactAttribution } from '@/lib/ghl';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 60;

// Carga UNICA (a mano, no un cron) del historico de citas que ya
// existian antes de activar el webhook. Se puede correr varias veces
// sin duplicar nada (ghl_appointment_id es UNIQUE en la tabla).
//
// Uso: POST /api/backfill-ghl?since=2026-01-01&until=2026-08-13
// Header: Authorization: Bearer <CRON_SECRET>
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const since = req.nextUrl.searchParams.get('since');
  const until = req.nextUrl.searchParams.get('until');
  if (!since || !until) {
    return NextResponse.json({ error: 'Faltan ?since=YYYY-MM-DD&until=YYYY-MM-DD en la URL' }, { status: 400 });
  }

  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    return NextResponse.json({ error: 'Faltan GHL_API_TOKEN o GHL_LOCATION_ID en el servidor.' }, { status: 500 });
  }

  const db = supabaseAdmin();
  let inserted = 0, skipped = 0, failed = 0;
  const errors: string[] = [];
  let calendarDiagnostics: any[] = [];
  let calendarsRaw: any = null;

  try {
    const result = await fetchGhlAppointments({
      token,
      locationId,
      startTime: new Date(since).toISOString(),
      endTime: new Date(until).toISOString(),
    });
    calendarDiagnostics = result.diagnostics;
    calendarsRaw = result.calendarsRaw;

    for (const appt of result.appointments) {
      try {
        const attribution = await fetchGhlContactAttribution({ token, contactId: appt.contactId });

        const { error, count } = await db
          .from('ghl_appointments')
          .upsert(
            {
              ghl_appointment_id: appt.id,
              ghl_contact_id: appt.contactId,
              contact_name: attribution.name,
              contact_phone: attribution.phone,
              contact_email: attribution.email,
              meta_campaign_id: attribution.campaignId,
              meta_adset_id: attribution.adsetId,
              meta_ad_id: attribution.adId,
              utm_source: attribution.utmSource,
              utm_medium: attribution.utmMedium,
              appointment_start_at: appt.startTime,
              appointment_created_at: appt.dateAdded || null,
              source: 'backfill',
              raw: appt,
            },
            { onConflict: 'ghl_appointment_id', ignoreDuplicates: true }
          );

        if (error) { failed++; errors.push(`${appt.id}: ${error.message}`); }
        else inserted++;
      } catch (err: any) {
        failed++;
        errors.push(`${appt.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message, calendarsRaw }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    range: { since, until },
    inserted,
    skipped,
    failed,
    errors: errors.slice(0, 20), // solo las primeras 20 para no saturar la respuesta
    // Diagnostico: cuantos calendarios encontro y cuantos eventos trajo
    // cada uno (o el error de ese calendario en particular). Esto es lo
    // que reemplaza tener que ir a buscar en los logs de Vercel.
    calendars_found: calendarDiagnostics.length,
    calendar_diagnostics: calendarDiagnostics,
    calendars_raw: calendarsRaw,
  });
}
