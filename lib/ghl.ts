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

export type GhlCalendarDiagnostic = {
  calendarId: string;
  status: 'ok' | 'error';
  eventCount: number;
  error?: string;
};

// GHL no deja pedir "todas las citas de la location" en una sola
// llamada - exige indicar DE QUE CALENDARIO especificamente (confirmado
// con el error real: "Either of userId, calendarId or groupId is
// required"). Por eso primero se trae la lista de calendarios de la
// cuenta, y despues se piden las citas calendario por calendario.
async function fetchGhlCalendarIds(params: { token: string; locationId: string }): Promise<{ ids: string[]; raw: any }> {
  const { token, locationId } = params;
  const url = `${API_BASE}/calendars/?locationId=${locationId}`;
  const res = await fetch(url, { headers: headers(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GHL /calendars respondio ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  const calendars: any[] = data.calendars || [];
  return { ids: calendars.map((c) => c.id).filter(Boolean), raw: data };
}

// Trae los eventos de calendario (citas) de un rango de fechas, de
// TODOS los calendarios de la location, uno por uno. Devuelve tanto las
// citas encontradas como un diagnostico calendario-por-calendario, para
// poder ver en la MISMA respuesta que exito o fallo cada uno - sin
// tener que ir a buscar logs del servidor aparte.
export async function fetchGhlAppointments(params: {
  token: string;
  locationId: string;
  startTime: string; // ISO
  endTime: string; // ISO
}): Promise<{ appointments: GhlAppointmentRaw[]; diagnostics: GhlCalendarDiagnostic[]; calendarsRaw: any }> {
  const { token, locationId, startTime, endTime } = params;

  const { ids: calendarIds, raw: calendarsRaw } = await fetchGhlCalendarIds({ token, locationId });
  if (calendarIds.length === 0) {
    // Se devuelve vacio en vez de tirar error - asi la respuesta de
    // /api/backfill-ghl igual trae el "calendarsRaw" crudo, para poder
    // ver que devolvio GHL aunque no haya encontrado ningun ID.
    return { appointments: [], diagnostics: [], calendarsRaw };
  }

  const allAppointments: GhlAppointmentRaw[] = [];
  const diagnostics: GhlCalendarDiagnostic[] = [];

  // Se piden TODOS los calendarios al mismo tiempo (en paralelo), no
  // uno por uno en fila - con 17 calendarios, hacerlo en fila puede
  // tardar lo suficiente para que Vercel corte la funcion por tiempo
  // (error 504).
  const results = await Promise.all(
    calendarIds.map(async (calendarId) => {
      const url = `${API_BASE}/calendars/events?locationId=${locationId}&calendarId=${calendarId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
      const res = await fetch(url, { headers: headers(token) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { calendarId, status: 'error' as const, eventCount: 0, error: JSON.stringify(data).slice(0, 400), events: [] as GhlAppointmentRaw[] };
      }
      const events = data.events || data.appointments || [];
      return { calendarId, status: 'ok' as const, eventCount: events.length, events };
    })
  );

  for (const r of results) {
    diagnostics.push({ calendarId: r.calendarId, status: r.status, eventCount: r.eventCount, error: 'error' in r ? r.error : undefined });
    allAppointments.push(...r.events);
  }

  return { appointments: allAppointments, diagnostics, calendarsRaw };
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
