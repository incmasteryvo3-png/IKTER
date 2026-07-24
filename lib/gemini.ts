const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function generateAnalysis(consolidatedData: unknown, promptOverride?: string) {
  const prompt = promptOverride || buildPrompt(consolidatedData);

  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // Grounding con Busqueda de Google: permite que el modelo consulte
      // informacion actual (tendencias, comportamiento del algoritmo de
      // Meta) en vez de responder solo con lo que sabe de su entrenamiento.
      // Nota: esto tiene un costo adicional por llamada en la API de Gemini.
      tools: [{ google_search: {} }],
    }),
  });

  const json = await res.json();
  if (json.error) throw new Error(`Gemini API error: ${json.error.message}`);

  const parts = json.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('\n');
  if (!text) throw new Error('Gemini no devolvio texto utilizable.');
  return text as string;
}

export function buildPrompt(data: unknown) {
  return `
Eres un analista senior de marketing digital especializado en Meta Ads.
Analiza estos datos y da un analisis util para tomar decisiones reales,
no un resumen generico. Considera comportamiento tipico del algoritmo de
Meta (fase de aprendizaje, fatiga de creativos, frecuencia alta, CPM/CPA
por encima de referencias del sector) y tendencias actuales de anuncios
en redes sociales que conozcas.

Datos (JSON):
${JSON.stringify(data, null, 2)}

Responde en español, en este formato exacto (markdown):

## Hallazgos clave
- (3 a 5 puntos concretos, con numeros del propio JSON)

## Que esta funcionando
- (1 a 3 puntos)

## Que hay que revisar o pausar
- (1 a 3 puntos, especifico con nombres)

## Siguiente paso recomendado
(1 parrafo corto, maximo 3 frases, accion concreta y priorizada)

No inventes numeros que no esten en los datos. Si un dato falta, dilo en vez de asumirlo.
`.trim();
}
