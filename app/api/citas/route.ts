import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 30;

// Lee las citas YA GUARDADAS en Supabase (llegaron por webhook o por el
// backfill) y las agrupa por meta_ad_id. No le pregunta nada a la API
// de GHL en cada llamada - por eso "Actualizar ahora" no se pone lento
// ni depende de que GHL responda rapido.
export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('ghl_appointments')
    .select('meta_ad_id, contact_name, contact_phone, contact_email, utm_source, utm_medium, appointment_start_at, appointment_created_at')
    .not('meta_ad_id', 'is', null)
    .order('appointment_start_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byAd: Record<string, any[]> = {};
  for (const row of data || []) {
    const key = row.meta_ad_id as string;
    if (!byAd[key]) byAd[key] = [];
    byAd[key].push(row);
  }

  return NextResponse.json({ ok: true, citasByAdId: byAd });
}
