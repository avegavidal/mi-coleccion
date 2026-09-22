/**
 * Cliente Gemini compartido: modelos actuales (sin 1.5) y manejo de cuota.
 *
 * gemini-2.0-flash está apagado en AI Studio; priorizamos 2.5 Flash (mejor
 * visión + grounding) y rotamos a lite/pro si hay 429 en free tier.
 */

/** Orden general: mejor calidad/precio primero, luego fallbacks free-friendly. */
export const PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-001'
];

/**
 * Visión / foto: 2.5 Flash es el sweet spot (rápido + entiende cajas).
 * Pro solo si Flash falla o cuota 0.
 */
export const VISION_PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
];

/** @type {Map<string, { at: number, models: string[], purpose: string }>} */
const listCache = new Map();
const LIST_TTL_MS = 15 * 60 * 1000;

/**
 * @param {string} apiKey
 * @param {{ forceRefresh?: boolean, max?: number, purpose?: 'general'|'vision'|'price' }} [opts]
 * @returns {Promise<string[]>}
 */
export async function resolveGeminiModels(apiKey, opts = {}) {
  const max = opts.max ?? 8;
  const purpose = opts.purpose || 'general';
  const preferred = purpose === 'vision' || purpose === 'price'
    ? VISION_PREFERRED_MODELS
    : PREFERRED_MODELS;

  if (!apiKey) return preferred.slice(0, max);

  const cacheKey = `${apiKey}::${purpose}`;
  if (!opts.forceRefresh) {
    const cached = listCache.get(cacheKey);
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
        .filter((id) => id && !/1\.5|embedding|tts|audio|image-preview|robotics|imagen/i.test(id));

      const preferredHit = preferred.filter((id) => available.includes(id));
      const flashExtras = available.filter((id) =>
        /flash/i.test(id) && !preferredHit.includes(id) && !/image|tts|audio|live/i.test(id)
      );
      const proExtras = available.filter((id) =>
        /pro/i.test(id) && !preferredHit.includes(id) && !flashExtras.includes(id)
        && !/image|tts|audio|live/i.test(id)
      );
      const models = [...preferredHit, ...flashExtras, ...proExtras];
      if (models.length) {
        listCache.set(cacheKey, { at: Date.now(), models, purpose });
        return models.slice(0, max);
      }
    }
  } catch {
    // fallback estático
  }

  const fallback = [...preferred];
  listCache.set(cacheKey, { at: Date.now(), models: fallback, purpose });
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
 * @param {{ signal?: AbortSignal, models?: string[], preferModel?: string, purpose?: 'general'|'vision'|'price' }} [opts]
 */
export async function geminiGenerateContent(apiKey, body, opts = {}) {
  let models = opts.models?.length
    ? opts.models
    : await resolveGeminiModels(apiKey, { purpose: opts.purpose || 'general' });

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
      // Solo propagar AbortError si fue NUESTRO signal (Detener / nueva búsqueda).
      // Timeouts de proxy, adblock, etc. también pueden venir como AbortError.
      if (err.name === 'AbortError') {
        if (opts.signal?.aborted) throw err;
        lastErr = 'Red interrumpida al contactar Gemini';
        continue;
      }
      if (/Gemini \d|Modelo Gemini/i.test(err.message) && !/429|Cuota|free:/i.test(err.message)) throw err;
      lastErr = err.message;
    }
  }

  if (sawQuota) {
    // Refrescar lista por si hay modelos nuevos
    for (const key of [...listCache.keys()]) {
      if (key.startsWith(`${apiKey}::`) || key === apiKey) listCache.delete(key);
    }
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

/**
 * URLs reales citadas por Google Search grounding (mejores que inventadas).
 * @param {object} data
 * @returns {string[]}
 */
export function extractGroundingUrls(data) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const url = String(u || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const cand = data?.candidates?.[0];
  const meta = cand?.groundingMetadata || data?.groundingMetadata || {};
  for (const chunk of meta.groundingChunks || []) {
    push(chunk?.web?.uri || chunk?.web?.url);
  }
  for (const support of meta.groundingSupports || []) {
    for (const idx of support?.groundingChunkIndices || []) {
      const chunk = (meta.groundingChunks || [])[idx];
      push(chunk?.web?.uri || chunk?.web?.url);
    }
  }
  // Algunos responses incluyen searchEntryPoint / citations
  for (const cite of cand?.citationMetadata?.citationSources || []) {
    push(cite?.uri || cite?.url);
  }
  return out;
}

/**
 * Asigna URLs de grounding a matches sin link de anuncio exacto.
 * @param {Array<{source?:string,url?:string,linkExact?:boolean,title?:string}>} matches
 * @param {string[]} groundingUrls
 */
export function assignGroundingUrlsToMatches(matches, groundingUrls) {
  const urls = (groundingUrls || [])
    .map((u) => normalizeGroundingUrl(u))
    .filter(Boolean);
  if (!matches?.length || !urls.length) return matches || [];

  const byStore = {
    ebay: urls.filter((u) => /ebay\./i.test(u)),
    amazon: urls.filter((u) => /amazon\./i.test(u)),
    mercari: urls.filter((u) => /mercari\./i.test(u)),
    amiami: urls.filter((u) => /amiami\./i.test(u)),
    yahoo: urls.filter((u) => /yahoo\.|auctions\.yahoo/i.test(u)),
    tcgplayer: urls.filter((u) => /tcgplayer\./i.test(u)),
    cardmarket: urls.filter((u) => /cardmarket\./i.test(u)),
    pricecharting: urls.filter((u) => /pricecharting\./i.test(u)),
    mandarake: urls.filter((u) => /mandarake\./i.test(u))
  };

  const used = new Set();
  return matches.map((m) => {
    if (m.linkExact && m.url && isLikelyListingUrl(m.url)) return m;
    const src = String(m.source || '').toLowerCase();
    const pool = byStore[src] || [];
    const pick = pool.find((u) => !used.has(u));
    if (!pick || !isLikelyListingUrl(pick)) return m;
    used.add(pick);
    return {
      ...m,
      url: pick,
      linkExact: true,
      note: m.note || 'Anuncio (grounding)'
    };
  });
}

function normalizeGroundingUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  u = u.replace(/^<|>$/g, '').trim();
  if (!/^https?:\/\//i.test(u) && /^[\w.-]+\.[a-z]{2,}([/:?]|$)/i.test(u)) u = `https://${u}`;
  if (!/^https?:\/\//i.test(u)) return '';
  if (/vertexaisearch\.cloud\.google\.com|grounding-api-redirect/i.test(u)) return '';
  try {
    const parsed = new URL(u);
    if (/google\./i.test(parsed.hostname) && (parsed.searchParams.has('url') || parsed.searchParams.has('q'))) {
      const inner = parsed.searchParams.get('url') || parsed.searchParams.get('q') || '';
      if (/^https?:\/\//i.test(inner) && !/google\./i.test(inner)) return normalizeGroundingUrl(inner);
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function isLikelyListingUrl(url) {
  const u = normalizeGroundingUrl(url) || String(url || '');
  if (!/^https?:\/\//i.test(u)) return false;
  return (
    /ebay\.[^/]+\/itm\//i.test(u)
    || /amazon\.[^/]+\/(dp|gp\/product)\//i.test(u)
    || /mercari\.com\/(?:us\/)?item\//i.test(u)
    || /jp\.mercari\.com\/item\//i.test(u)
    || /amiami\.com\/.+\/detail\//i.test(u)
    || /tcgplayer\.com\/product\//i.test(u)
    || /page\.auctions\.yahoo\.co\.jp\/jp\/auction\//i.test(u)
    || /pricecharting\.com\/game\//i.test(u)
    || /cardmarket\.com\/.+\/Products\//i.test(u)
  );
}
