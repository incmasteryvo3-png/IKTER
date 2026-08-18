import { fetchGa4Overview, fetchGa4Channels } from '@/lib/ga4';
import { supabaseAdmin } from '@/lib/supabase';

export async function runGa4Sync() {
  const db = supabaseAdmin();
  const propertyId = process.env.GA4_PROPERTY_ID!;

  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [overview, channels] = await Promise.all([
    fetchGa4Overview({ since, until }),
    fetchGa4Channels({ since, until }),
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
    }));
    const { error: channelsErr } = await db.from('ga4_channel_snapshots').insert(toInsert);
    if (channelsErr) throw new Error(`channels: ${channelsErr.message}`);
    channelRows = toInsert.length;
  }

  return { property_id: propertyId, overview_saved: true, channel_rows_saved: channelRows, range: { since, until } };
}
