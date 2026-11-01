import { fetchMetaInsights } from '@/lib/meta';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccounts, type AdAccount } from '@/lib/accounts';

// Sincroniza el historial de TODAS las cuentas configuradas en
// META_AD_ACCOUNTS (o la unica de META_AD_ACCOUNT_ID). Cada cuenta va
// en paralelo e independiente: si una falla, las otras se guardan igual.
export async function runMetaSync() {
  const accounts = getAdAccounts();
  if (!accounts.length) throw new Error('No hay cuentas configuradas (META_AD_ACCOUNTS o META_AD_ACCOUNT_ID).');

  const results = await Promise.allSettled(accounts.map((a) => syncAccount(a)));
  const per_account = results.map((r, i) => (
    r.status === 'fulfilled'
      ? { account: accounts[i].id, name: accounts[i].name, ...r.value }
      : { account: accounts[i].id, name: accounts[i].name, error: r.reason?.message || 'Error' }
  ));
  const ok = per_account.filter((r: any) => !r.error);
  if (!ok.length) throw new Error(per_account.map((r: any) => `${r.name}: ${r.error}`).join(' | '));

  return {
    rows_saved: ok.reduce((s: number, r: any) => s + (r.rows_saved || 0), 0),
    per_account,
  };
}

async function syncAccount(acc: AdAccount) {
  const db = supabaseAdmin();
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  const adAccountId = acc.id;

  const { data: account, error: accErr } = await db
    .from('ad_accounts')
    .upsert({ meta_account_id: adAccountId, name: acc.name }, { onConflict: 'meta_account_id' })
    .select()
    .single();

  if (accErr) throw new Error(accErr.message);

  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const levels: Array<'campaign' | 'adset' | 'ad'> = ['campaign', 'adset', 'ad'];
  let totalRows = 0;

  for (const level of levels) {
    const rows = await fetchMetaInsights({ adAccountId, token, level, since, until });
    if (rows.length === 0) continue;

    const toInsert = rows.map((r) => ({
      ad_account_id: account.id,
      level: r.level,
      level_id: r.level_id,
      level_name: r.level_name,
      date_start: since,
      date_stop: until,
      spend: r.spend,
      impressions: r.impressions,
      reach: r.reach,
      clicks: r.clicks,
      link_clicks: r.link_clicks,
      video_plays: r.video_plays,
      video_avg_watch_seconds: r.video_avg_watch_seconds,
      video_play_time: r.video_play_time_estimate,
      landing_page_views: r.landing_page_views,
      results: r.results,
      cost_per_result: r.cost_per_result,
      ctr: r.ctr,
      cpc: r.cpc,
      raw: r.raw,
    }));

    const { error: insErr } = await db.from('insight_snapshots').insert(toInsert);
    if (insErr) throw new Error(`${level}: ${insErr.message}`);
    totalRows += toInsert.length;
  }

  return { account_id: account.id, rows_saved: totalRows, range: { since, until } };
}
