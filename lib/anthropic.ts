const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-5';

export async function generateAnthropicAnalysis(consolidatedData: unknown, promptOverride?: string) {
  const prompt = promptOverride || buildPrompt(consolidatedData);

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
      // Herramienta de busqueda web: permite que Claude consulte tendencias
      // y comportamiento actual del algoritmo de Meta antes de responder.
      // Nota: tiene costo adicional por busqueda realizada.
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    }),
  });

  const json = await res.json();
  if (json.error) throw new Error(`Anthropic API error: ${json.error.message}`);

  const textBlocks = (json.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text);
  const text = textBlocks.join('\n');
  if (!text) throw new Error('Claude no devolvio texto utilizable.');
  return text as string;
}

function buildPrompt(data: unknown) {
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
