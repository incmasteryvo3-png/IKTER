-- ============================================================
-- MASTERY DASHBOARD - Extensión GA4 (Google Analytics 4)
-- Correr DESPUES de sql/schema.sql. Es seguro re-ejecutar este
-- archivo (usa drop policy if exists, igual que el schema original).
-- ============================================================

create table if not exists ga4_snapshots (
  id bigint generated always as identity primary key,
  ga4_property_id text not null,
  date_start date not null,
  date_stop date not null,
  sessions bigint default 0,
  total_users bigint default 0,
  new_users bigint default 0,
  engaged_sessions bigint default 0,
  engagement_rate numeric(6,4),
  avg_session_duration numeric(10,2),
  conversions bigint default 0,
  event_count bigint default 0,
  screen_page_views bigint default 0,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_ga4_snapshots_property_date
  on ga4_snapshots (ga4_property_id, date_start desc);

create table if not exists ga4_channel_snapshots (
  id bigint generated always as identity primary key,
  ga4_property_id text not null,
  date_start date not null,
  date_stop date not null,
  channel_group text not null,
  sessions bigint default 0,
  conversions bigint default 0,
  engagement_rate numeric(6,4),
  fetched_at timestamptz not null default now()
);

create index if not exists idx_ga4_channels_property_date
  on ga4_channel_snapshots (ga4_property_id, date_start desc);

alter table ga4_snapshots enable row level security;
alter table ga4_channel_snapshots enable row level security;

-- Mismo criterio de acceso que insight_snapshots (Meta): cualquier
-- usuario con sesion iniciada puede leer. Cuando exista separacion
-- real por cliente (Fase 2), esto se ajusta igual que el resto.
drop policy if exists "usuarios_autenticados_leen_ga4_snapshots" on ga4_snapshots;
create policy "usuarios_autenticados_leen_ga4_snapshots"
  on ga4_snapshots for select
  using (auth.role() = 'authenticated');

drop policy if exists "usuarios_autenticados_leen_ga4_channels" on ga4_channel_snapshots;
create policy "usuarios_autenticados_leen_ga4_channels"
  on ga4_channel_snapshots for select
  using (auth.role() = 'authenticated');
