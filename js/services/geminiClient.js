/**
 * Cliente Gemini compartido: modelos actuales (sin 1.5) y manejo de cuota.
 *
 * En nivel gratuito, un 429 con dashboard vacío suele ser “limit: 0” en un modelo
 * concreto (p. ej. 2.5-flash), no uso acumulado. Rotamos modelos y reintentamos.
 */

/** Orden: free-friendly primero, luego más nuevos. */
export const PREFERRED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash-001'
];

/** @type {Map<string, { at: number, models: string[] }>} */
const listCache = new Map();
const LIST_TTL_MS = 15 * 60 * 1000;

/**
 * @param {string} apiKey
 * @param {{ forceRefresh?: boolean, max?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function resolveGeminiModels(apiKey, opts = {}) {
  const max = opts.max ?? PREFERRED_MODELS.length;
  if (!apiKey) return PREFERRED_MODELS.slice(0, max);

  if (!opts.forceRefresh) {
    const cached = listCache.get(apiKey);
    if (cached && Date.now() - cached.at < LIST_TTL_MS && cached.models.length) {
      return cached.models.slice(0, max);
    }
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`
    );
    if (res.ok) {
      const data = await res.json();
      const available = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((id) => id && !/1\.5|embedding|tts|audio|image-preview|robotics/i.test(id));

      const preferred = PREFERRED_MODELS.filter((id) => available.includes(id));
      const flashExtras = available.filter((id) =>
        /flash/i.test(id) && !preferred.includes(id)
      );
      const models = [...preferred, ...flashExtras];
      if (models.length) {
        listCache.set(apiKey, { at: Date.now(), models });
        return models.slice(0, max);
      }
    }
  } catch {
    // fallback estático
  }

  const fallback = [...PREFERRED_MODELS];
  listCache.set(apiKey, { at: Date.now(), models: fallback });
  return fallback.slice(0, max);
}

/**
 * @param {number} status
 * @param {string} body
 */
export function formatGeminiHttpError(status, body) {
  const text = String(body || '');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(text)) {
    const freeZero = /free_tier|limit:\s*0/i.test(text);
    if (freeZero) {
      return (
        'Gemini free: este modelo tiene cuota 0 (aunque el uso aparezca vacío). '
        + 'Se probarán otros modelos automáticamente. '
        + 'O activa facturación en AI Studio → Facturación.'
      );
    }
    return (
      'Cuota/rate limit Gemini (HTTP 429). En free el dashboard a veces no muestra uso. '
      + 'Reintentando con otro modelo / espera…'
    );
  }
  if (status === 404 || /not found|not supported/i.test(text)) {
    return `Modelo Gemini no disponible (${status}).`;
  }
  return `Gemini ${status}: ${text.slice(0, 160)}`;
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @param {string} apiKey
 * @param {object} body
 * @param {{ signal?: AbortSignal, models?: string[], preferModel?: string }} [opts]
 */
export async function geminiGenerateContent(apiKey, body, opts = {}) {
  let models = opts.models?.length
    ? opts.models
    : await resolveGeminiModels(apiKey);

  if (opts.preferModel) {
    models = [opts.preferModel, ...models.filter((m) => m !== opts.preferModel)];
  }

  let lastErr = '';
  let lastStatus = 0;
  let sawQuota = false;

  for (const model of models) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    }
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

      // 429 en un modelo: probar el siguiente (free a menudo tiene limit 0 por modelo)
      if (res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(lastErr)) {
        sawQuota = true;
        continue;
      }
      if (res.status === 404 || res.status === 400) continue;
      throw new Error(formatGeminiHttpError(res.status, lastErr));
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (/Gemini \d|Modelo Gemini/i.test(err.message) && !/429|Cuota|free:/i.test(err.message)) throw err;
      lastErr = err.message;
    }
  }

  if (sawQuota) {
    // Refrescar lista por si hay modelos nuevos
    listCache.delete(apiKey);
    throw new Error(formatGeminiHttpError(429, lastErr));
  }

  throw new Error(
    formatGeminiHttpError(lastStatus || 0, lastErr)
    || 'Ningún modelo Gemini disponible. Revisa la API key en AI Studio.'
  );
}

export function geminiTextFromResponse(data) {
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
}
