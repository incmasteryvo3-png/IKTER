// ============================================================
// Puente Meta -> GA4
// ============================================================
// Este archivo NO es parte de IKTER (el dashboard). Es un modulo
// independiente para pegar en el sitio/backend donde HOY se disparan
// los eventos de conversion hacia Meta (Pixel del navegador y/o
// Conversions API del servidor), para que el MISMO evento tambien
// quede registrado en GA4, vía la GA4 Measurement Protocol.
//
// Requiere 2 variables de entorno nuevas (se sacan en GA4 -> Admin ->
// Flujos de datos -> tu stream -> "Measurement Protocol API secrets"):
//   GA4_MEASUREMENT_ID   (formato "G-XXXXXXXXXX")
//   GA4_API_SECRET
//
// IMPORTANTE - lo que hay que decidir antes de usar esto en serio:
//
// 1. client_id: GA4 necesita el mismo client_id que ya tiene esa
//    persona en su cookie de Analytics (_ga) para que el evento se
//    una a su sesion real en el sitio. Si mandas un client_id
//    inventado, el evento SI aparece en GA4 pero como una sesion
//    nueva y desconectada de todo lo demas que hizo esa persona.
//    - Si el evento se dispara en el NAVEGADOR (ej. al enviar un
//      formulario, antes o junto con fbq('track', ...)): lee el
//      client_id real desde la cookie _ga (funcion mas abajo) y
//      mandalo al backend junto con los demas datos del evento.
//    - Si el evento se dispara SOLO en el servidor (ej. un webhook de
//      tu CRM cuando se marca un lead como venta, sin que el
//      navegador este involucrado): no hay client_id real disponible.
//      En ese caso hay que decidir: (a) guardar el client_id de la
//      persona en tu base de datos cuando llega el lead la primera
//      vez, para reusarlo despues, o (b) aceptar que ese evento en
//      GA4 va a verse como una sesion nueva.
//
// 2. Nombres de evento: usa los nombres recomendados de GA4 cuando
//    existan equivalentes (ej. "generate_lead", "purchase") en vez de
//    inventar nombres nuevos - asi GA4 los reconoce automaticamente
//    como conversiones sin configuracion extra.
// ============================================================

const GA4_MP_URL = 'https://www.google-analytics.com/mp/collect';

export type Ga4Event = {
  client_id: string;
  event_name: string; // ej. 'generate_lead', 'purchase', 'schedule'
  params?: Record<string, string | number | boolean>;
  user_id?: string; // opcional: tu propio ID de usuario/lead, si lo tienes
};

export async function sendEventToGa4(event: Ga4Event): Promise<{ ok: boolean; status: number }> {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;

  if (!measurementId || !apiSecret) {
    throw new Error('Faltan GA4_MEASUREMENT_ID o GA4_API_SECRET en el entorno.');
  }

  const url = `${GA4_MP_URL}?measurement_id=${measurementId}&api_secret=${apiSecret}`;

  const body: Record<string, unknown> = {
    client_id: event.client_id,
    events: [{ name: event.event_name, params: event.params || {} }],
  };
  if (event.user_id) body.user_id = event.user_id;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // La Measurement Protocol devuelve 204 sin cuerpo cuando todo sale
  // bien - no hay JSON de confirmacion que revisar.
  return { ok: res.status === 204 || res.status === 200, status: res.status };
}

// Traduce los nombres de evento que usas hacia Meta (Pixel/CAPI) a los
// nombres recomendados de GA4, para que quede igual de reconocido como
// conversion en ambos lados. Ajusta este mapa a los eventos reales que
// dispara el sitio (ver EVENTS en IKTER/app/page.tsx para la lista que
// ya se usa del lado de Meta).
export const META_TO_GA4_EVENT_NAME: Record<string, string> = {
  Lead: 'generate_lead',
  CompleteRegistration: 'sign_up',
  Schedule: 'schedule', // evento personalizado, GA4 no tiene equivalente estandar
  SubmitApplication: 'submit_application', // idem
  Purchase: 'purchase',
  Subscribe: 'subscribe', // idem
  ViewContent: 'view_item',
  PageView: 'page_view', // GA4 ya lo captura solo si tienes el tag base instalado
};

// Para usar en el NAVEGADOR (donde SI existe la cookie _ga real):
// obtiene el client_id de la persona a partir de la cookie que ya
// puso el tag de gtag.js/GA4 instalado en el sitio.
export function getGa4ClientIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/_ga=(GA\d\.\d\.\d+\.\d+)/);
  if (!match) return null;
  // La cookie _ga trae el formato "GA1.2.123456789.1699999999" -
  // el client_id real que espera la Measurement Protocol son los
  // ultimos dos segmentos: "123456789.1699999999".
  const parts = match[1].split('.');
  return parts.slice(-2).join('.');
}
