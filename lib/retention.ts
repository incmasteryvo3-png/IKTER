// ============================================================
// "Una foto por dia" + limpieza automatica del historial.
//
// Antes, cada sincronizacion (boton "Actualizar ahora" o el workflow
// manual) agregaba OTRA copia completa de los ultimos 30 dias, asi que
// la tabla crecia con filas repetidas. Ahora cada sync reemplaza la foto
// de HOY (hora de Colombia) y borra lo que tenga mas de N dias.
//
// SNAPSHOT_RETENTION_DAYS (opcional, por defecto 90) controla cuantos
// dias de fotos se guardan.
// ============================================================

const BOGOTA_OFFSET_HOURS = -5; // Colombia no usa horario de verano

/** Inicio del dia de hoy en Bogota, como ISO UTC (ej. 2026-11-01T05:00:00.000Z). */
export function todayStartIso(now = new Date()): string {
  const local = new Date(now.getTime() + BOGOTA_OFFSET_HOURS * 3600_000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  return new Date(Date.UTC(y, m, d) - BOGOTA_OFFSET_HOURS * 3600_000).toISOString();
}

/** Todo lo anterior a esta fecha se borra. */
export function retentionCutoffIso(now = new Date()): string {
  const days = Math.max(7, parseInt(process.env.SNAPSHOT_RETENTION_DAYS || '90', 10) || 90);
  return new Date(now.getTime() - days * 86400_000).toISOString();
}
