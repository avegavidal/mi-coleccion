/**
 * Cliente Gemini compartido: elige modelos actuales (sin 1.5 retireados).
 */

const PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-flash-latest'
];

/** @type {Map<string, { at: number, models: string[] }>} */
const listCache = new Map();
const LIST_TTL_MS = 30 * 60 * 1000;

/**
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
export async function resolveGeminiModels(apiKey) {
  if (!apiKey) return [...PREFERRED_MODELS];
  const cached = listCache.get(apiKey);
  if (cached && Date.now() - cached.at < LIST_TTL_MS && cached.models.length) {
    return cached.models;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`
    );
    if (!res.ok) throw new Error(`list ${res.status}`);
    const data = await res.json();
    const available = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean);

    const preferred = PREFERRED_MODELS.filter((id) => available.includes(id));
    const flashExtras = available.filter((id) =>
      /flash/i.test(id)
      && !/image|tts|audio|embed|robotics/i.test(id)
      && !preferred.includes(id)
    );
    const models = [...preferred, ...flashExtras].slice(0, 6);
    if (models.length) {
      listCache.set(apiKey, { at: Date.now(), models });
      return models;
    }
  } catch {
    // fallback estático
  }

  return [...PREFERRED_MODELS];
}

/**
 * @param {string} apiKey
 * @param {object} body  generateContent request body
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function geminiGenerateContent(apiKey, body, opts = {}) {
  const models = await resolveGeminiModels(apiKey);
  let lastErr = '';
  let lastStatus = 0;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal
      });
      if (res.ok) {
        return { model, data: await res.json() };
      }
      lastStatus = res.status;
      lastErr = await res.text();
      // 404 / modelo inválido → probar siguiente
      if (res.status === 404 || res.status === 400) continue;
      throw new Error(`Gemini ${res.status}: ${String(lastErr).slice(0, 180)}`);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (/Gemini \d/.test(err.message)) throw err;
      lastErr = err.message;
    }
  }

  throw new Error(
    `Ningún modelo Gemini disponible (${lastStatus || 'error'}). `
    + `Prueba regenerar la API key en Google AI Studio. ${String(lastErr).slice(0, 120)}`
  );
}

export function geminiTextFromResponse(data) {
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
}
