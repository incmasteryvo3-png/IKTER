// ============================================================
// Cliente minimo para Gemini API (analisis en lenguaje simple)
// ============================================================

// Uso gemini-2.5-flash: gemini-2.5-pro salio del nivel gratuito de la
// API de Gemini a mediados de 2026 (quedo solo para cuentas con
// facturacion activada). Flash es gratuito y de sobra para este resumen.
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function generateAnalysis(consolidatedData: unknown) {
  const prompt = buildPrompt(consolidatedData);

  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  const json = await res.json();

  if (json.error) {
    throw new Error(`Gemini API error: ${json.error.message}`);
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini no devolvio texto utilizable.');

  return text as string;
}

function buildPrompt(data: unknown) {
  return `
Eres un analista de marketing digital explicando resultados de Meta Ads a alguien
sin conocimientos tecnicos, como si se lo explicaras a un niño de 5 años pero sin
sonar infantil: frases cortas, sin jerga, directo al punto.

Aqui tienes los datos consolidados de campañas, conjuntos de anuncios y anuncios
(incluye pagado y organico donde aplique), en formato JSON:

${JSON.stringify(data, null, 2)}

Responde en español, en este formato exacto (markdown):

## Hallazgos clave
- (3 a 5 puntos, cada uno una frase corta y concreta)

## Que esta funcionando
- (1 a 3 puntos)

## Que hay que revisar o pausar
- (1 a 3 puntos, se especifico con nombres de campaña/anuncio)

## Siguiente paso recomendado
(1 parrafo corto, maximo 3 frases, con una accion concreta)

No inventes numeros que no esten en los datos. Si un dato falta, dilo en vez de asumirlo.
`.trim();
}
