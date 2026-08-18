-- ============================================================
-- MASTERY DASHBOARD - Extensión GHL (citas agendadas)
-- Correr DESPUES de sql/schema.sql y sql/schema_ga4.sql.
-- Es seguro re-ejecutar este archivo (usa drop policy if exists).
-- ============================================================

create table if not exists ghl_appointments (
  id bigint generated always as identity primary key,

  -- Identificadores de GHL (para evitar duplicados: un mismo appointment_id
  -- nunca se inserta dos veces, sea que llegue por webhook o por el backfill).
  ghl_appointment_id text unique not null,
  ghl_contact_id text,

  -- Datos de la persona.
  contact_name text,
  contact_phone text,
  contact_email text,

  -- Atribucion a Meta - estos 3 son los que permiten el cruce con IKTER.
  -- Pueden quedar en null si la cita no tiene atribucion clara (organico,
  -- referido, o un lead viejo sin UTM guardado) - eso es normal, no un error.
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  utm_source text,
  utm_medium text,

  -- Fechas.
  appointment_start_at timestamptz,
  appointment_created_at timestamptz,

  -- Origen del registro: 'webhook' (llego en tiempo real) o 'backfill'
  -- (se trajo con la carga historica puntual a la API de GHL).
  source text not null default 'webhook',

  -- Payload crudo tal cual llego, por si despues hace falta revisar o
  -- reprocesar sin tener que volver a pedirselo a GHL.
  raw jsonb,

  inserted_at timestamptz not null default now()
);

create index if not exists idx_ghl_appointments_ad_id
  on ghl_appointments (meta_ad_id);
create index if not exists idx_ghl_appointments_adset_id
  on ghl_appointments (meta_adset_id);
create index if not exists idx_ghl_appointments_start_at
  on ghl_appointments (appointment_start_at desc);

alter table ghl_appointments enable row level security;

-- Mismo criterio que el resto del dashboard: cualquier usuario con sesion
-- iniciada puede leer. Confirmado contigo que por ahora no hace falta
-- restringir esto a un rol distinto.
drop policy if exists "usuarios_autenticados_leen_ghl_appointments" on ghl_appointments;
create policy "usuarios_autenticados_leen_ghl_appointments"
  on ghl_appointments for select
  using (auth.role() = 'authenticated');
