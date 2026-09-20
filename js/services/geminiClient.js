/**
 * Cliente Gemini compartido: modelos actuales (sin 1.5) y manejo de cuota.
 *
 * Las keys de AI Studio usan cuota del proyecto (free o paid). Un 429 no es
 * un bug de la app: Google rechaza la petición por límite del proyecto.
 */

/** Pocos modelos, del más estable/barato al más nuevo — evita quemar cuota en reintentos. */
const PREFERRED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-latest'
];

const MAX_MODEL_TRIES = 2;

/** @type {Map<string, { at: number, models: string[] }>} */
const listCache = new Map();
const LIST_TTL_MS = 30 * 60 * 1000;

/**
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
export async function resolveGeminiModels(apiKey) {
  if (!apiKey) return PREFERRED_MODELS.slice(0, MAX_MODEL_TRIES);

  const cached = listCache.get(apiKey);
  if (cached && Date.now() - cached.at < LIST_TTL_MS && cached.models.length) {
    return cached.models.slice(0, MAX_MODEL_TRIES);
  }

  // Preferir lista estática: ListModels también cuenta contra el proyecto.
  const staticPick = PREFERRED_MODELS.slice(0, MAX_MODEL_TRIES);
  listCache.set(apiKey, { at: Date.now(), models: staticPick });
  return staticPick;
}

/**
 * @param {number} status
 * @param {string} body
 */
export function formatGeminiHttpError(status, body) {
  const text = String(body || '');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(text)) {
    return (
      'Cuota Gemini agotada (HTTP 429). La key de AI Studio usa el cupo del proyecto '
      + '(free o paid). Revisa uso y billing en https://aistudio.google.com/ — '
      + 'activa facturación o espera el reset diario. No es un fallo de Mi Colección.'
    );
  }
  if (status === 404 || /not found|not supported/i.test(text)) {
    return `Modelo Gemini no disponible (${status}).`;
  }
  return `Gemini ${status}: ${text.slice(0, 160)}`;
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

      // Cuota: no probar más modelos (cada intento gasta más).
      if (res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(lastErr)) {
        throw new Error(formatGeminiHttpError(429, lastErr));
      }
      // 404 / modelo inválido → siguiente
      if (res.status === 404 || res.status === 400) continue;
      throw new Error(formatGeminiHttpError(res.status, lastErr));
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (/Cuota Gemini|Gemini \d|Modelo Gemini/i.test(err.message)) throw err;
      lastErr = err.message;
    }
  }

  throw new Error(
    formatGeminiHttpError(lastStatus || 0, lastErr)
    || 'Ningún modelo Gemini disponible. Revisa la API key en AI Studio.'
  );
}

export function geminiTextFromResponse(data) {
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
}
