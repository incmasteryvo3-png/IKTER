-- ============================================================
-- MASTERY DASHBOARD - Migración v0.6
-- Correr UNA vez en Supabase → SQL Editor → New query → Run.
-- Es seguro volver a correrla (todo usa "if not exists" o es idempotente).
--
-- Qué hace:
--   1. Agrega a ai_summaries las columnas para guardar los análisis de IA
--      por sección (y poder verlos de nuevo sin volver a pagarlos).
--   2. Índices para que la limpieza diaria de fotos sea rápida.
--   3. Limpieza ÚNICA del historial repetido que ya existe: deja una sola
--      foto por día (la última) en insight_snapshots y en las tablas de GA4,
--      y borra lo que tenga más de 90 días.
-- ============================================================

-- 1) Análisis de IA guardados ----------------------------------------
alter table ai_summaries add column if not exists provider text;
alter table ai_summaries add column if not exists section_key text;
alter table ai_summaries add column if not exists data_hash text;
alter table ai_summaries add column if not exists meta_account_id text;
alter table ai_summaries add column if not exists title text;

create index if not exists idx_ai_summaries_section
  on ai_summaries (section_key, provider, generated_at desc);

-- 2) Índices para la limpieza automática -----------------------------
create index if not exists idx_snapshots_account_fetched
  on insight_snapshots (ad_account_id, fetched_at);
create index if not exists idx_ga4_snapshots_property_fetched
  on ga4_snapshots (ga4_property_id, fetched_at);
create index if not exists idx_ga4_channels_property_fetched
  on ga4_channel_snapshots (ga4_property_id, fetched_at);

-- 3) Limpieza única del historial repetido ---------------------------
-- Meta: una fila por (cuenta, nivel, entidad, día en hora de Colombia),
-- se conserva la más reciente.
delete from insight_snapshots s
using (
  select id,
         row_number() over (
           partition by ad_account_id, level, level_id, (fetched_at at time zone 'America/Bogota')::date
           order by fetched_at desc, id desc
         ) as rn
  from insight_snapshots
) d
where s.id = d.id and d.rn > 1;

-- GA4 (resumen): una fila por (propiedad, día).
delete from ga4_snapshots s
using (
  select id,
         row_number() over (
           partition by ga4_property_id, (fetched_at at time zone 'America/Bogota')::date
           order by fetched_at desc, id desc
         ) as rn
  from ga4_snapshots
) d
where s.id = d.id and d.rn > 1;

-- GA4 (canales): una fila por (propiedad, canal, día).
delete from ga4_channel_snapshots s
using (
  select id,
         row_number() over (
           partition by ga4_property_id, channel_group, (fetched_at at time zone 'America/Bogota')::date
           order by fetched_at desc, id desc
         ) as rn
  from ga4_channel_snapshots
) d
where s.id = d.id and d.rn > 1;

-- Más de 90 días (mismo valor por defecto que SNAPSHOT_RETENTION_DAYS).
delete from insight_snapshots     where fetched_at < now() - interval '90 days';
delete from ga4_snapshots         where fetched_at < now() - interval '90 days';
delete from ga4_channel_snapshots where fetched_at < now() - interval '90 days';

-- Para ver el resultado:
-- select count(*) from insight_snapshots;
