import { fetchGa4Overview, fetchGa4Channels } from '@/lib/ga4';
import { supabaseAdmin } from '@/lib/supabase';
import { getAllGa4PropertyIds } from '@/lib/accounts';
import { todayStartIso, retentionCutoffIso } from '@/lib/retention';

// Sincroniza TODAS las propiedades de GA4 configuradas (una por cuenta
// publicitaria si usas GA4_PROPERTY_IDS, o la unica de GA4_PROPERTY_ID).
// Igual que Meta: una sola foto por dia y limpieza automatica.
export async function runGa4Sync() {
  const properties = getAllGa4PropertyIds();
  if (!properties.length) throw new Error('Falta GA4_PROPERTY_ID (o GA4_PROPERTY_IDS) en el servidor.');

  const results = await Promise.allSettled(properties.map((p) => syncProperty(p)));
  const per_property = results.map((r, i) => (
    r.status === 'fulfilled' ? r.value : { property_id: properties[i], error: (r as any).reason?.message || 'Error' }
  ));
  if (per_property.every((r: any) => r.error)) {
    throw new Error(per_property.map((r: any) => `${r.property_id}: ${r.error}`).join(' | '));
  }
  return { per_property };
}

async function syncProperty(propertyId: string) {
  const db = supabaseAdmin();
  const runAt = new Date().toISOString();

  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [overview, channels] = await Promise.all([
    fetchGa4Overview({ since, until, propertyId }),
    fetchGa4Channels({ since, until, propertyId }),
  ]);

  const { error: overviewErr } = await db.from('ga4_snapshots').insert({
    ga4_property_id: propertyId,
    date_start: since,
    date_stop: until,
    sessions: overview.sessions,
    total_users: overview.total_users,
    new_users: overview.new_users,
    engaged_sessions: overview.engaged_sessions,
    engagement_rate: overview.engagement_rate,
    avg_session_duration: overview.avg_session_duration,
    conversions: overview.conversions,
    event_count: overview.event_count,
    screen_page_views: overview.screen_page_views,
    raw: overview,
    fetched_at: runAt,
  });
  if (overviewErr) throw new Error(`overview: ${overviewErr.message}`);

  let channelRows = 0;
  if (channels.length > 0) {
    const toInsert = channels.map((c) => ({
      ga4_property_id: propertyId,
      date_start: since,
      date_stop: until,
      channel_group: c.channel,
      sessions: c.sessions,
      conversions: c.conversions,
      engagement_rate: c.engagement_rate,
      fetched_at: runAt,
    }));
    const { error: channelsErr } = await db.from('ga4_channel_snapshots').insert(toInsert);
    if (channelsErr) throw new Error(`channels: ${channelsErr.message}`);
    channelRows = toInsert.length;
  }

  // Una foto por dia + retencion (mismo criterio que insight_snapshots).
  for (const table of ['ga4_snapshots', 'ga4_channel_snapshots']) {
    const { error: e1 } = await db.from(table).delete().eq('ga4_property_id', propertyId).gte('fetched_at', todayStartIso()).lt('fetched_at', runAt);
    if (e1) console.error(`Limpieza (hoy) ${table}:`, e1.message);
    const { error: e2 } = await db.from(table).delete().eq('ga4_property_id', propertyId).lt('fetched_at', retentionCutoffIso());
    if (e2) console.error(`Limpieza (retencion) ${table}:`, e2.message);
  }

  return { property_id: propertyId, overview_saved: true, channel_rows_saved: channelRows, range: { since, until } };
}
