-- ============================================================
-- MASTERY DASHBOARD - Esquema de base de datos (Supabase/Postgres)
-- ============================================================

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists client_members (
  client_id uuid references clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'viewer',
  primary key (client_id, user_id)
);

create table if not exists ad_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  meta_account_id text not null,
  name text not null,
  currency text default 'USD',
  created_at timestamptz not null default now(),
  unique (meta_account_id)
);

create table if not exists meta_campaigns (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid references ad_accounts(id) on delete cascade,
  meta_campaign_id text not null unique,
  name text not null,
  status text,
  updated_at timestamptz not null default now()
);

create table if not exists meta_adsets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references meta_campaigns(id) on delete cascade,
  meta_adset_id text not null unique,
  name text not null,
  status text,
  updated_at timestamptz not null default now()
);

create table if not exists meta_ads (
  id uuid primary key default gen_random_uuid(),
  adset_id uuid references meta_adsets(id) on delete cascade,
  meta_ad_id text not null unique,
  name text not null,
  creative_thumbnail_url text,
  status text,
  updated_at timestamptz not null default now()
);

create table if not exists insight_snapshots (
  id bigint generated always as identity primary key,
  ad_account_id uuid references ad_accounts(id) on delete cascade,
  level text not null check (level in ('campaign','adset','ad')),
  level_id text not null,
  level_name text not null,
  date_start date not null,
  date_stop date not null,
  spend numeric(12,2) default 0,
  impressions bigint default 0,
  reach bigint default 0,
  clicks bigint default 0,
  link_clicks bigint default 0,
  video_plays bigint default 0,
  video_play_time bigint default 0,
  video_avg_watch_seconds numeric(6,2),
  landing_page_views bigint default 0,
  results bigint default 0,
  cost_per_result numeric(12,2),
  ctr numeric(6,4),
  cpc numeric(12,2),
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_snapshots_account_date
  on insight_snapshots (ad_account_id, date_start desc);
create index if not exists idx_snapshots_level
  on insight_snapshots (level, level_id, date_start desc);

create table if not exists ai_summaries (
  id bigint generated always as identity primary key,
  ad_account_id uuid references ad_accounts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  summary_md text not null,
  model text not null default 'gemini-2.5-flash',
  generated_at timestamptz not null default now()
);

alter table clients enable row level security;
alter table client_members enable row level security;
alter table ad_accounts enable row level security;
alter table insight_snapshots enable row level security;
alter table ai_summaries enable row level security;

drop policy if exists "Los usuarios ven solo sus clientes" on clients;
create policy "Los usuarios ven solo sus clientes"
  on clients for select
  using (
    id in (select client_id from client_members where user_id = auth.uid())
  );

drop policy if exists "Los usuarios ven solo sus cuentas publicitarias" on ad_accounts;
create policy "Los usuarios ven solo sus cuentas publicitarias"
  on ad_accounts for select
  using (
    client_id in (select client_id from client_members where user_id = auth.uid())
  );

drop policy if exists "Los usuarios ven solo sus snapshots" on insight_snapshots;
create policy "Los usuarios ven solo sus snapshots"
  on insight_snapshots for select
  using (
    ad_account_id in (
      select aa.id from ad_accounts aa
      join client_members cm on cm.client_id = aa.client_id
      where cm.user_id = auth.uid()
    )
  );

drop policy if exists "Los usuarios ven solo sus analisis de IA" on ai_summaries;
create policy "Los usuarios ven solo sus analisis de IA"
  on ai_summaries for select
  using (
    ad_account_id in (
      select aa.id from ad_accounts aa
      join client_members cm on cm.client_id = aa.client_id
      where cm.user_id = auth.uid()
    )
  );

-- Lectura abierta temporal (solo mientras no exista login, Fase 1)
drop policy if exists "fase1_lectura_publica_snapshots" on insight_snapshots;
create policy "fase1_lectura_publica_snapshots"
  on insight_snapshots for select
  using (true);

drop policy if exists "fase1_lectura_publica_resumenes" on ai_summaries;
create policy "fase1_lectura_publica_resumenes"
  on ai_summaries for select
  using (true);
