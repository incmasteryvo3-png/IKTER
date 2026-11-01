'use client';

// ============================================================
// Analisis de IA guardados (lado navegador).
// - Al abrir una tarjeta, busca si ya existe un analisis de ESA seccion
//   con ESOS mismos datos: si existe, se muestra sin volver a pagar.
// - Muestra los analisis anteriores de la misma seccion para comparar
//   (ej. lo que dijo la IA la semana pasada contra hoy).
// Todas las tarjetas de una pantalla se consultan en UNA sola llamada.
// ============================================================

import { useEffect, useState } from 'react';

export type SavedRow = {
  provider: string;
  section_key: string;
  data_hash: string;
  summary_md: string;
  generated_at: string;
  period_start: string;
  period_end: string;
};

export async function hashPayload(data: unknown): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(data ?? null));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

// ---- Cargador en lote: junta las secciones pedidas en ~40 ms ----
const cache = new Map<string, Promise<Record<string, SavedRow[]>>>();
let pending: { keys: Set<string>; resolvers: ((v: Record<string, SavedRow[]>) => void)[] } | null = null;

function loadBatch(sectionKey: string): Promise<Record<string, SavedRow[]>> {
  if (cache.has(sectionKey)) return cache.get(sectionKey)!;
  const p = new Promise<Record<string, SavedRow[]>>((resolve) => {
    if (!pending) {
      pending = { keys: new Set(), resolvers: [] };
      setTimeout(async () => {
        const batch = pending!;
        pending = null;
        let result: Record<string, SavedRow[]> = {};
        try {
          const res = await fetch('/api/analyze/saved', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: Array.from(batch.keys) }),
          });
          const json = await res.json();
          result = json.saved || {};
        } catch { /* sin historial, no pasa nada */ }
        batch.resolvers.forEach((r) => r(result));
      }, 40);
    }
    pending.keys.add(sectionKey);
    pending.resolvers.push(resolve);
  });
  cache.set(sectionKey, p);
  return p;
}

/** Olvida lo cargado de una seccion (despues de generar un analisis nuevo). */
export function forgetSaved(sectionKey: string) {
  cache.delete(sectionKey);
}

export function useSavedAnalysis(provider: string, sectionKey: string | undefined, payload: unknown) {
  const [exact, setExact] = useState<SavedRow | null>(null);
  const [history, setHistory] = useState<SavedRow[]>([]);
  const [hash, setHash] = useState('');
  const payloadJson = JSON.stringify(payload ?? null);

  useEffect(() => {
    let alive = true;
    if (!sectionKey) return;
    (async () => {
      const h = await hashPayload(payload);
      if (!alive) return;
      setHash(h);
      const all = await loadBatch(sectionKey);
      if (!alive) return;
      const rows = all[`${provider}::${sectionKey}`] || [];
      const match = rows.find((r) => r.data_hash === h) || null;
      setExact(match);
      setHistory(rows.filter((r) => r !== match));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, sectionKey, payloadJson]);

  return { exact, history, hash };
}

export function fmtSavedDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** Lista desplegable de analisis anteriores de la misma seccion. */
export function SavedHistory({ rows, render, className }: { rows: SavedRow[]; render: (md: string) => string; className: string }) {
  if (!rows.length) return null;
  return (
    <details className={className}>
      <summary>Análisis anteriores de esta sección ({rows.length})</summary>
      {rows.map((r, i) => (
        <details key={i} className={`${className}-item`}>
          <summary>
            {fmtSavedDate(r.generated_at)}
            <span className={`${className}-period`}> · datos del {r.period_start} al {r.period_end}</span>
          </summary>
          <div className={`${className}-body`} dangerouslySetInnerHTML={{ __html: render(r.summary_md) }} />
        </details>
      ))}
    </details>
  );
}
