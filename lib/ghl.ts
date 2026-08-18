// ============================================================
// Cliente para la API v2 de GoHighLevel (services.leadconnectorhq.com).
// Se usa SOLO para el backfill historico (una vez, o cuando tu lo pidas
// a mano) - las citas del dia a dia entran por webhook, no por aqui.
//
// AVISO IMPORTANTE: los nombres exactos de los campos de atribucion
// (attributionSource / customFields) estan armados con la estructura
// mas comun documentada de la API v2 de GHL, pero no se pudieron probar
// contra una respuesta real de tu cuenta. Antes de confiar en el
// backfill para produccion, corre GET /api/diagnostics/ghl (ver mas
// abajo) contra UN contacto real que sepas que tiene UTMs, y compara el
// JSON crudo contra lo que este archivo espera. Si algo no calza, se
// ajusta aqui - es un solo archivo, no toca el resto del sistema.
// ============================================================

const API_BASE = 'https://services.leadconnectorhq.com';
// Header obligatorio de la API v2 de GHL - sin esto, todas las llamadas
// devuelven error. Si GHL saca una version mas nueva, este valor cambia.
const API_VERSION = '2021-07-28';

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Version: API_VERSION,
    Accept: 'application/json',
  };
}

export type GhlAppointmentRaw = {
  id: string;
  contactId: string;
  startTime: string;
  dateAdded?: string;
};

// Trae los eventos de calendario (citas) de un rango de fechas. Pagina
// automaticamente si la cuenta tiene mas de las que trae una sola pagina.
export async function fetchGhlAppointments(params: {
  token: string;
  locationId: string;
  startTime: string; // ISO
  endTime: string; // ISO
}): Promise<GhlAppointmentRaw[]> {
  const { token, locationId, startTime, endTime } = params;
  const url = `${API_BASE}/calendars/events?locationId=${locationId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;

  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GHL /calendars/events respondio ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  // La forma exacta de la respuesta (events/appointments como nombre de
  // la propiedad) puede variar - se prueban las 2 mas comunes.
  return data.events || data.appointments || [];
}

export type GhlContactAttribution = {
  name: string | null;
  phone: string | null;
  email: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
};

// Trae un contacto y extrae de ahi los datos de atribucion. Intenta
// varias rutas dentro del JSON porque GHL guarda esto distinto segun si
// la landing es "plana" (atribucion nativa, campo attributionSource) o
// si vino de un formulario con UTMs como campos ocultos (customFields).
export async function fetchGhlContactAttribution(params: {
  token: string;
  contactId: string;
}): Promise<GhlContactAttribution> {
  const { token, contactId } = params;
  const url = `${API_BASE}/contacts/${contactId}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GHL /contacts/${contactId} respondio ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const contact = data.contact || data;

  // customFields llega como arreglo [{id, key/name, value}] en la API v2.
  const customFields: any[] = contact.customFields || contact.customField || [];
  function fromCustomField(key: string): string | null {
    const field = customFields.find(
      (f) => (f.key || f.name || '').toLowerCase().replace(/\s+/g, '_') === key
    );
    return field?.value || field?.fieldValue || null;
  }

  // La atribucion nativa (landings planas) puede venir en distintas
  // formas segun la version de la cuenta - se revisan varias.
  const attribution = contact.attributionSource || contact.lastAttributionSource || contact.firstAttributionSource || {};

  const campaignId = attribution.campaign || attribution.utmCampaign || fromCustomField('utm_campaign') || fromCustomField('utm_id') || null;
  const adsetId = attribution.utmTerm || attribution.term || fromCustomField('utm_term') || fromCustomField('utm_keyword') || null;
  const adId = attribution.utmContent || attribution.content || fromCustomField('utm_content') || null;
  const utmSource = attribution.utmSource || attribution.source || fromCustomField('utm_source') || null;
  const utmMedium = attribution.utmMedium || attribution.medium || fromCustomField('utm_medium') || null;

  return {
    name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || null,
    phone: contact.phone || null,
    email: contact.email || null,
    campaignId,
    adsetId,
    adId,
    utmSource,
    utmMedium,
  };
}
