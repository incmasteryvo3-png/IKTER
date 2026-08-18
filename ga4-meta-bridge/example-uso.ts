// ============================================================
// EJEMPLO - no es codigo que se ejecute solo. Es la forma de pegarlo
// justo al lado de donde HOY llamas a la Conversions API de Meta.
// ============================================================
import { sendEventToGa4, META_TO_GA4_EVENT_NAME, getGa4ClientIdFromCookie } from './sendToGa4';

// --------------------------------------------------------------
// CASO A: el evento se dispara en el servidor y SI tienes el
// client_id real (porque el formulario lo mando desde el navegador
// junto con los demas datos del lead).
// --------------------------------------------------------------
async function alRecibirLeadEnElBackend(lead: {
  email: string;
  ga4ClientId: string; // capturado en el navegador con getGa4ClientIdFromCookie()
}) {
  // ... aqui va tu llamada actual a la Meta Conversions API (sin tocar) ...
  // await enviarLeadAMeta(lead);

  // Y en paralelo, el mismo evento hacia GA4:
  try {
    await sendEventToGa4({
      client_id: lead.ga4ClientId,
      event_name: META_TO_GA4_EVENT_NAME.Lead, // 'generate_lead'
      params: { source: 'meta_ads' },
    });
  } catch (err) {
    // Un fallo aca NUNCA debe tumbar el flujo principal (el lead ya se
    // guardo y ya se le mando a Meta) - solo se registra el error.
    console.error('No se pudo replicar el evento hacia GA4:', err);
  }
}

// --------------------------------------------------------------
// CASO B: el formulario del sitio necesita mandar su client_id de GA4
// al backend junto con los demas datos (para el Caso A de arriba).
// Esto va en el codigo del FRONTEND del sitio, no en el backend.
// --------------------------------------------------------------
function alEnviarFormularioEnElSitio() {
  const ga4ClientId = getGa4ClientIdFromCookie();
  // fetch('/api/leads', { method: 'POST', body: JSON.stringify({ ...datosDelFormulario, ga4ClientId }) })
  return ga4ClientId;
}
