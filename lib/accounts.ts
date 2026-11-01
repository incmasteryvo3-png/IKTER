// ============================================================
// Cuentas publicitarias de Meta disponibles en el selector.
//
// Se configuran con UNA variable de entorno en Vercel:
//   META_AD_ACCOUNTS=act_111111111:Mastery TikTok,act_222222222:Mastery Aesthetics
// (formato: id:nombre, separadas por coma; el nombre es solo lo que se ve)
//
// Si META_AD_ACCOUNTS no existe, se usa META_AD_ACCOUNT_ID (como antes),
// asi nada se rompe mientras no agregues la variable nueva.
//
// Seguridad: el servidor SOLO consulta cuentas que esten en esta lista,
// aunque alguien mande otro id desde el navegador.
// ============================================================

export type AdAccount = { id: string; name: string };

export function getAdAccounts(): AdAccount[] {
  const raw = (process.env.META_AD_ACCOUNTS || '').trim();
  const list: AdAccount[] = [];
  if (raw) {
    for (const part of raw.split(',')) {
      const [idRaw, ...nameParts] = part.split(':');
      let id = (idRaw || '').trim();
      if (!id) continue;
      if (!id.startsWith('act_')) id = `act_${id}`;
      const name = nameParts.join(':').trim() || id;
      if (!list.some((a) => a.id === id)) list.push({ id, name });
    }
  }
  if (list.length === 0 && process.env.META_AD_ACCOUNT_ID) {
    const id = process.env.META_AD_ACCOUNT_ID.trim();
    list.push({ id, name: 'Cuenta principal' });
  }
  return list;
}

/** Devuelve la cuenta pedida si esta permitida; si no, la primera de la lista. */
export function resolveAdAccount(requested: string | null | undefined): AdAccount | null {
  const list = getAdAccounts();
  if (list.length === 0) return null;
  if (requested) {
    const norm = requested.startsWith('act_') ? requested : `act_${requested}`;
    const found = list.find((a) => a.id === norm);
    if (found) return found;
  }
  return list[0];
}
