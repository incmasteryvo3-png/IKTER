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
  const debug = req.nextUrl.searchParams.get('debug') === '1';
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
      startTime: String(new Date(since).getTime()),
      endTime: String(new Date(until).getTime()),
    });
    calendarDiagnostics = result.diagnostics;
    calendarsRaw = result.calendarsRaw;

    // Se procesan de a 10 citas en paralelo (no todas de golpe, para no
    // saturar la API de GHL con cientos de llamadas simultaneas; no una
    // por una, para no repetir el problema de lentitud que causo el 504).
    const CHUNK_SIZE = 10;
    for (let i = 0; i < result.appointments.length; i += CHUNK_SIZE) {
      const chunk = result.appointments.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (appt) => {
          try {
            const attribution = await fetchGhlContactAttribution({ token, contactId: appt.contactId });
            const { error } = await db
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
            return error ? { ok: false, id: appt.id, msg: error.message } : { ok: true };
          } catch (err: any) {
            return { ok: false, id: appt.id, msg: err.message };
          }
        })
      );
      for (const r of chunkResults) {
        if (r.ok) inserted++;
        else { failed++; errors.push(`${r.id}: ${r.msg}`); }
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
    // Un solo numero resumen, para no tener que copiar el arreglo
    // completo de diagnosticos cada vez que se prueba - si esto es 0,
    // GHL no devolvio NINGUN evento en ningun calendario para el rango.
    total_events_found: calendarDiagnostics.reduce((sum, d) => sum + (d.eventCount || 0), 0),
    calendar_diagnostics: calendarDiagnostics,
    calendars_raw: debug ? calendarsRaw : undefined,
  });
}
