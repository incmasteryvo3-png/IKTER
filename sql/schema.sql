-- ============================================================
-- MASTERY DASHBOARD - Esquema de base de datos (Supabase/Postgres)
-- ============================================================
-- Diseñado para:
--   1) Guardar snapshots de Meta Ads (campaña / conjunto / anuncio)
--   2) Guardar el analisis generado por Gemini
--   3) Estar listo desde el dia 1 para login multi-cliente (Fase 2)
--      via Supabase Auth + Row Level Security (RLS)
-- ============================================================

-- ------------------------------------------------------------
-- 1) CLIENTES (para cuando esto sea una plataforma con login)
-- ------------------------------------------------------------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,                      -- ej: "Mastery Academy"
  owner_user_id uuid references auth.users(id), -- dueño/admin del cliente
  created_at timestamptz not null default now()
);

-- Relacion muchos-a-muchos: que usuarios pueden ver que cliente
create table if not exists client_members (
  client_id uuid references clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'viewer',     -- 'owner' | 'viewer'
  primary key (client_id, user_id)
);

-- ------------------------------------------------------------
-- 2) CUENTAS PUBLICITARIAS DE META (una o varias por cliente)
-- ------------------------------------------------------------
create table if not exists ad_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  meta_account_id text not null,           -- ej: "act_123456789"
  name text not null,                      -- ej: "Mastery Academy - Cuenta principal"
  currency text default 'USD',
  created_at timestamptz not null default now(),
  unique (meta_account_id)
);

-- ------------------------------------------------------------
-- 3) ENTIDADES DE META (campaña, conjunto de anuncios, anuncio)
--    Se guarda la jerarquia para poder navegar campaña -> anuncio
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 4) SNAPSHOTS DE METRICAS (el corazon del dashboard)
--    Una fila por cada "sync" y por cada nivel (campaign/adset/ad)
--    level_id = meta_campaign_id o meta_adset_id o meta_ad_id
--    Esto permite reconstruir exactamente las tablas de tus infografias
--    y ademas guardar HISTORICO real (algo que las capturas no tienen)
-- ------------------------------------------------------------
create table if not exists insight_snapshots (
  id bigint generated always as identity primary key,
  ad_account_id uuid references ad_accounts(id) on delete cascade,
  level text not null check (level in ('campaign','adset','ad')),
  level_id text not null,               -- id de Meta del objeto medido
  level_name text not null,             -- nombre legible
  date_start date not null,
  date_stop date not null,
  spend numeric(12,2) default 0,
  impressions bigint default 0,
  reach bigint default 0,
  clicks bigint default 0,
  link_clicks bigint default 0,
  video_plays bigint default 0,
  video_play_time bigint default 0,     -- suma de ms/seg reproducidos
  video_avg_watch_seconds numeric(6,2),
  landing_page_views bigint default 0,
  results bigint default 0,             -- evento de conversion configurado
  cost_per_result numeric(12,2),
  ctr numeric(6,4),
  cpc numeric(12,2),
  raw jsonb,                             -- respuesta cruda de Meta (auditoria)
  fetched_at timestamptz not null default now()
);

create index if not exists idx_snapshots_account_date
  on insight_snapshots (ad_account_id, date_start desc);
create index if not exists idx_snapshots_level
  on insight_snapshots (level, level_id, date_start desc);

-- ------------------------------------------------------------
-- 5) ANALISIS GENERADO POR GEMINI
--    Se guarda para no volver a llamar a la IA en cada visita
-- ------------------------------------------------------------
create table if not exists ai_summaries (
  id bigint generated always as identity primary key,
  ad_account_id uuid references ad_accounts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  summary_md text not null,             -- texto en markdown, listo para mostrar
  model text not null default 'gemini-2.5-pro',
  generated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 6) ROW LEVEL SECURITY (se activa cuando exista login de clientes)
--    Por ahora, con Service Role Key en el backend, RLS no bloquea
--    las funciones serverless. Cuando el frontend consulte
--    directamente con el usuario logueado, estas reglas aplican.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 7) LECTURA ABIERTA TEMPORAL (solo mientras no exista login)
--    Sin esto, el dashboard se veria vacio: las politicas de arriba
--    exigen un usuario logueado con relacion en client_members, y
--    en la Fase 1 (sin login) eso nunca existe.
--    IMPORTANTE: eliminar estas 2 politicas cuando se active el login
--    de clientes en la Fase 2 (ahi ya quedan cubiertas por las
--    politicas de la seccion 6, que son las que de verdad protegen
--    los datos de cada cliente).
-- ------------------------------------------------------------
drop policy if exists "fase1_lectura_publica_snapshots" on insight_snapshots;
create policy "fase1_lectura_publica_snapshots"
  on insight_snapshots for select
  using (true);

drop policy if exists "fase1_lectura_publica_resumenes" on ai_summaries;
create policy "fase1_lectura_publica_resumenes"
  on ai_summaries for select
  using (true);
