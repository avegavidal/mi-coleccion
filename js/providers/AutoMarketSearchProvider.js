/**
 * Búsqueda automática de precios de mercado.
 * 1) Gemini + Google Search (si hay API key) → coincidencias con precio
 * 2) eBay vía proxies (fallback)
 * Devuelve matches seleccionables; no solo enlaces.
 */

import { EbayActiveProvider, extractEbayListings, extractEbayPrices } from './EbayActiveProvider.js';
import { ebayMarketUrls, buildShopLinksForQuery, buildVisualMarketLinks, isTcgCardItem, storeLinkForMatch, isDirectListingUrl } from './EbayLinkProvider.js';

function readGeminiApiKey() {
  try {
    if (typeof localStorage !== 'undefined') {
      const fromLs = localStorage.getItem('mi_coleccion_gemini_api_key');
      if (fromLs && fromLs.trim()) return fromLs.trim();
    }
  } catch {
    // ignore
  }
  try {
    return String(globalThis.APP_CONFIG?.GEMINI_API_KEY || globalThis.window?.APP_CONFIG?.GEMINI_API_KEY || '').trim();
  } catch {
    return '';
  }
}

/**
 * @typedef {{
 *  id: string,
 *  title: string,
 *  price: number,
 *  currency: string,
 *  source: string,
 *  url?: string,
 *  query?: string,
 *  score?: number,
 *  note?: string
 * }} MarketMatch
 */

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Búsqueda cancelada'), { name: 'AbortError' }));
      return;
    }
    const t = setTimeout(resolve, Math.max(0, Number(ms) || 0));
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error('Búsqueda cancelada'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @param {MarketMatch[]} matches
 */
export function hasUsefulMarketMatches(matches) {
  return (matches || []).some((m) => Number.isFinite(Number(m?.price)) && Number(m.price) > 0);
}

/**
 * @param {object} item
 * @param {{ imageUrl?: string|null, onProgress?: (p:{stage:string,message:string,attempt?:number})=>void, limit?: number, signal?: AbortSignal, maxAttempts?: number }} [opts]
 */
export async function autoSearchMarketMatches(item, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const limit = opts.limit || 12;
  const signal = opts.signal;
  const queries = buildSearchQueries(item);
  const imageUrl = opts.imageUrl || null;
  /** @type {MarketMatch[]} */
  let matches = [];
  const errors = [];
  const apiKey = readGeminiApiKey();
  const maxAttempts = opts.maxAttempts ?? (apiKey ? 40 : 2);

  const { resolveGeminiModels } = await import('../services/geminiClient.js');
  let modelList = apiKey ? await resolveGeminiModels(apiKey, { forceRefresh: true }) : [];
  let modelCursor = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Búsqueda cancelada'), { name: 'AbortError' });
    }

    onProgress({
      stage: 'attempt',
      attempt,
      message: `Intento ${attempt}/${maxAttempts}: buscando precio útil…`
    });

    // 1) Gemini (rotar modelo cada intento)
    if (apiKey) {
      const preferModel = modelList[modelCursor % Math.max(modelList.length, 1)] || 'gemini-2.0-flash';
      modelCursor += 1;
      onProgress({
        stage: 'gemini',
        attempt,
        message: `IA (${preferModel}) + foto/datos — intento ${attempt}…`
      });
      try {
        const geminiMatches = await searchMarketWithGemini(item, {
          apiKey,
          imageUrl,
          queries,
          limit,
          preferModel,
          models: modelList,
          signal
        });
        matches = mergeMatches(matches, geminiMatches);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        errors.push(`Gemini #${attempt}: ${err.message}`);
        onProgress({
          stage: 'gemini',
          attempt,
          message: `IA falló (${String(err.message).slice(0, 80)}). Sigo con otras fuentes…`
        });
        // Refrescar modelos si hubo cuota
        if (/429|cuota|free:|quota/i.test(err.message)) {
          try {
            modelList = await resolveGeminiModels(apiKey, { forceRefresh: true });
          } catch {
            // keep
          }
        }
      }
    } else if (attempt === 1) {
      errors.push('Sin Gemini API key: ve a Configuración y guárdala para precios automáticos.');
      onProgress({ stage: 'gemini', message: 'Sin API key de Gemini — precios automáticos limitados…' });
    }

    if (hasUsefulMarketMatches(matches)) break;

    // 2) eBay
    if (queries.length) {
      onProgress({ stage: 'ebay', attempt, message: `eBay automático (intento ${attempt})…` });
      const provider = new EbayActiveProvider();
      for (const q of queries.slice(0, 3)) {
        if (hasUsefulMarketMatches(matches) && matches.length >= 3) break;
        if (signal?.aborted) break;
        try {
          const live = await Promise.race([
            provider.lookup({ query: q, limit: 8 }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout eBay')), 14000))
          ]);
          const fromListings = (live.listings || []).map((l, i) => ({
            id: `ebay-${attempt}-${q}-${i}-${l.price}`,
            title: l.title || q,
            price: Number(l.price),
            currency: live.currency || 'USD',
            source: 'ebay',
            url: l.url || live.searchUrl || ebayMarketUrls(q).active,
            query: q,
            note: 'Anuncio eBay (en venta)'
          }));
          if (fromListings.length) {
            matches = mergeMatches(matches, fromListings);
          } else if (live.median != null) {
            const synth = [];
            for (const [label, price] of [['eBay bajo', live.low], ['eBay típico', live.median], ['eBay alto', live.high]]) {
              if (price == null) continue;
              synth.push({
                id: `ebay-stat-${attempt}-${q}-${label}-${price}`,
                title: `${label}: ${q}`,
                price: Number(price),
                currency: 'USD',
                source: 'ebay',
                url: live.searchUrl,
                query: q,
                note: live.note || 'Resumen de precios eBay'
              });
            }
            matches = mergeMatches(matches, synth);
          }
        } catch (err) {
          errors.push(`eBay “${q}”: ${err.message}`);
        }
      }
    }

    if (hasUsefulMarketMatches(matches)) break;

    // 3) Web index
    if (queries[0]) {
      onProgress({ stage: 'web', attempt, message: `Índice web (intento ${attempt})…` });
      try {
        const webMatches = await searchPricesViaWebIndex(queries[0], limit);
        matches = mergeMatches(matches, webMatches);
      } catch (err) {
        errors.push(`Web: ${err.message}`);
      }
    }

    if (hasUsefulMarketMatches(matches)) break;

    if (attempt >= maxAttempts) break;

    const waitMs = Math.min(45000, Math.round(2500 * (1.45 ** Math.min(attempt - 1, 7))));
    onProgress({
      stage: 'wait',
      attempt,
      message: `Aún sin precio útil. Reintento ${attempt + 1} en ${Math.round(waitMs / 1000)}s…`
    });
    await delay(waitMs, signal);
  }

  matches = scoreAndSortMatches(matches, item).slice(0, limit);

  const tcg = isTcgCardItem(item);
  if (tcg) {
    matches = [...matches].sort((a, b) => {
      const aM = isTcgMarketPriceMatch(a) ? 1 : 0;
      const bM = isTcgMarketPriceMatch(b) ? 1 : 0;
      if (bM !== aM) return bM - aM;
      return (b.score || 0) - (a.score || 0);
    });
  }

  const useful = hasUsefulMarketMatches(matches);
  const status = useful
    ? 'found'
    : (errors.length ? 'error' : 'empty');

  const primaryQuery = queries[0] || '';
  const shopIds = tcg
    ? ['tcgplayer', 'cardmarket', 'pricecharting', 'ebay-sold', 'ebay-active']
    : ['ebay-sold', 'ebay-active', 'amazon-us', 'amazon-jp', 'tcgplayer', 'cardmarket'];

  const ref = tcg ? pickTcgReferenceMatch(matches) : null;
  const refPrice = ref?.price != null ? Number(ref.price) : null;
  const median = refPrice != null && Number.isFinite(refPrice)
    ? refPrice
    : (matches.length ? pickMedian(matches.map((m) => m.price)) : null);

  return {
    status,
    matches: useful ? matches : [],
    queries,
    query: primaryQuery,
    imageUrl,
    errors: errors.slice(-12),
    tcg,
    reference: tcg ? 'tcgplayer-market' : 'median',
    referenceMatchId: ref?.id || null,
    sampleSize: useful ? matches.length : 0,
    low: useful ? Math.min(...matches.map((m) => m.price)) : null,
    median: useful ? median : null,
    high: useful ? Math.max(...matches.map((m) => m.price)) : null,
    currency: 'USD',
    links: [
      ...buildVisualMarketLinks(imageUrl),
      ...(primaryQuery
        ? buildShopLinksForQuery(primaryQuery, { tcg }).filter((l) => shopIds.includes(l.id))
        : [])
    ],
    note: status === 'found'
      ? (tcg
        ? (ref
          ? `Referencia: TCGPlayer Market Price $${Number(ref.price).toFixed(2)}. Elige la ideal si hay varias.`
          : `Encontré ${matches.length} coincidencia${matches.length === 1 ? '' : 's'}. Prefiere la de Market Price.`)
        : `Encontré ${matches.length} coincidencia${matches.length === 1 ? '' : 's'}. Elige la ideal.`)
      : !apiKey
        ? 'Para precios automáticos: Configuración → pega tu Gemini API key. Sin ella los marketplaces bloquean la lectura automática.'
      : status === 'empty'
        ? 'Tras varios intentos no encontré precios útiles. Revisa los datos o abre un buscador manual.'
        : `Tras reintentos no pude leer el mercado (${errors[errors.length - 1] || 'error'}). Puedes pulsar “Buscar de nuevo”.`
  };
}

function buildSearchQueries(item) {
  const parts = [];
  const manufacturer = clean(item?.manufacturer);
  const series = clean(item?.series);
  const character = clean(item?.character_name || item?.character);
  const itemNumber = clean(item?.item_number);
  const franchise = clean(item?.franchise);
  const soft = soften(clean(item?.name));
  const tcg = isTcgCardItem(item);

  if (tcg) {
    // Cartas: nombre + set/número suelen encontrar mejor en TCGPlayer
    if (soft && (series || franchise || itemNumber)) {
      parts.push([soft, series || franchise, itemNumber].filter(Boolean).join(' '));
    }
    if (character && (series || franchise)) parts.push([character, series || franchise].join(' '));
    if (soft) parts.push(`${soft} TCG`);
  }

  if (series && character) parts.push([series, character, manufacturer].filter(Boolean).join(' '));
  if (soft) parts.push(soft);
  if (franchise && character) parts.push([franchise, character].join(' '));
  if (manufacturer && itemNumber) parts.push([manufacturer, itemNumber].join(' '));
  if (manufacturer && character) parts.push([manufacturer, character].join(' '));

  const seen = new Set();
  const out = [];
  for (const q of parts) {
    const k = q.toLowerCase();
    if (!q || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
    if (out.length >= 3) break;
  }
  return out;
}

function clean(v) {
  return v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
}

function soften(name) {
  if (!name) return '';
  return name
    .replace(/\b(ver\.?|version|exclusive|limited|edition|special|dx|figure|fig)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 5)
    .join(' ');
}

/**
 * @param {object} item
 * @param {{ apiKey: string, imageUrl?: string|null, queries: string[], limit?: number, preferModel?: string, models?: string[], signal?: AbortSignal }} opts
 * @returns {Promise<MarketMatch[]>}
 */
export async function searchMarketWithGemini(item, opts) {
  const apiKey = opts.apiKey;
  const queries = opts.queries || [];
  const searchHint = queries.join(' | ') || item?.name || '';
  const meta = [
    item?.name && `Name: ${item.name}`,
    item?.manufacturer && `Manufacturer: ${item.manufacturer}`,
    item?.series && `Series: ${item.series}`,
    item?.character_name && `Character: ${item.character_name}`,
    item?.item_number && `Item #: ${item.item_number}`,
    item?.franchise && `Franchise: ${item.franchise}`
  ].filter(Boolean).join('\n');

  const tcg = isTcgCardItem(item);
  const prompt = `You are a collectible market price assistant (${tcg ? 'TRADING CARD / TCG specialist' : 'figures and collectibles'}).
${tcg
    ? `For TCG cards, the PRIMARY reference price is TCGPlayer "Market Price" (NOT Low Price, NOT Mid listing, NOT listed asking price).
Search TCGPlayer first and return the Market Price for the exact card (same set + collector number + finish/foil when visible).
You may also include Cardmarket trend / PriceCharting as secondary options, clearly labeled.`
    : 'Search the LIVE web for current asking/sold prices (eBay, Amazon, Mercari, AmiAmi, Yahoo Auctions JP).'}

Item data:
${meta || '(minimal data)'}

Search hints: ${searchHint}

Return ONLY valid JSON (no markdown) with this shape:
{
  "found": true|false,
  "matches": [
    {
      "title": "card/product title including set/number if card",
      "price": 49.99,
      "currency": "USD",
      "source": "${tcg ? 'tcgplayer|cardmarket|pricecharting|ebay|other' : 'ebay|amazon|mercari|amiami|yahoo|tcgplayer|cardmarket|other'}",
      "priceType": "${tcg ? 'market|low|mid|listing|estimate' : 'listing|estimate'}",
      "url": "https://...",
      "note": "short why it matches"
    }
  ]
}
Rules:
- price must be a number in USD when possible (convert EUR/JPY if needed; note original in "note").
- Include 1–8 matches if found; empty array if none.
- CRITICAL: "price" MUST be the price of the exact listing/product at "url". Do not invent prices.
- Prefer REAL listing URLs: ebay.com/itm/..., amazon.com/dp/..., mercari.com/item/..., tcgplayer.com/product/...
- If you cannot find the listing URL, set priceType to "estimate" and say so in note. Still set source correctly.
${tcg
    ? `- CRITICAL: at least one match MUST be TCGPlayer Market Price when available, with "source":"tcgplayer" and "priceType":"market" and note "TCGPlayer Market Price".
- Prefer Near Mint Market Price; put foil / alternate art as separate matches.
- Do NOT use Low Price as the main reference.`
    : '- If multiple variants exist, include several so the user can pick the ideal one.'}
- Never claim a store listing price without a matching product/listing url when one exists.`;

  const parts = [{ text: prompt }];

  if (opts.imageUrl) {
    try {
      const imgPart = await fetchImageAsInlinePart(opts.imageUrl);
      if (imgPart) parts.push(imgPart);
    } catch {
      // sin foto sigue por texto
    }
  }

  const {
    geminiGenerateContent,
    geminiTextFromResponse,
    formatGeminiHttpError
  } = await import('../services/geminiClient.js');

  const bodyPlain = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.2 }
  };
  const bodyWithTools = {
    contents: [{ parts }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 }
  };

  // Preferir grounding web primero: mejores URLs reales de anuncios.
  let lastErr = '';
  try {
    const out = await geminiGenerateContent(apiKey, bodyWithTools, {
      signal: opts.signal,
      models: opts.models,
      preferModel: opts.preferModel
    });
    const text = geminiTextFromResponse(out.data);
    const parsed = parseGeminiMarketMatches(text, searchHint);
    if (hasUsefulMarketMatches(parsed)) return parsed;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    lastErr = err.message;
  }

  try {
    const out = await geminiGenerateContent(apiKey, bodyPlain, {
      signal: opts.signal,
      models: opts.models,
      preferModel: opts.preferModel
    });
    const text = geminiTextFromResponse(out.data);
    return parseGeminiMarketMatches(text, searchHint);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(String(err.message || lastErr || formatGeminiHttpError(0, '')).slice(0, 280));
  }
}

/**
 * @param {string} text
 * @param {string} searchHint
 * @returns {MarketMatch[]}
 */
export function parseGeminiMarketMatches(text, searchHint = '') {
  const parsed = parseJsonObject(text);
  if (!parsed) throw new Error('Gemini no devolvió JSON de precios');

  const raw = Array.isArray(parsed.matches) ? parsed.matches : [];
  /** @type {MarketMatch[]} */
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i] || {};
    const price = Number(m.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const title = String(m.title || searchHint || 'Coincidencia').trim();
    const source = String(m.source || 'web');
    const rawUrl = typeof m.url === 'string' ? m.url.trim() : '';
    const exact = isDirectListingUrl(rawUrl);
    let priceType = String(m.priceType || inferPriceType(m)).toLowerCase();
    // Sin anuncio real no presentamos el precio como listing exacto
    if (!exact && priceType === 'listing') priceType = 'estimate';
    const noteBase = m.note
      ? String(m.note)
      : (priceType === 'market'
        ? 'TCGPlayer Market Price'
        : (exact ? 'Anuncio web' : 'Precio orientativo (sin link de anuncio exacto)'));
    out.push({
      id: `gem-${i}-${price}-${title.slice(0, 24)}`,
      title,
      price,
      currency: String(m.currency || 'USD').toUpperCase() === 'USD' ? 'USD' : String(m.currency || 'USD'),
      source,
      priceType,
      url: exact ? rawUrl : storeLinkForMatch({ source, title, url: rawUrl, query: searchHint, price }),
      linkExact: exact,
      query: searchHint,
      note: noteBase
    });
  }
  return out;
}

function inferPriceType(m) {
  const blob = `${m?.note || ''} ${m?.title || ''} ${m?.source || ''}`.toLowerCase();
  if (/market\s*price|precio\s*(de\s*)?mercado/.test(blob)) return 'market';
  if (/\blow\b|lowest/.test(blob)) return 'low';
  if (/\bmid\b|median/.test(blob)) return 'mid';
  if (/estimad|estimate/.test(blob)) return 'estimate';
  return 'listing';
}

/** True si el match es el Market Price de TCGPlayer (referencia). */
export function isTcgMarketPriceMatch(m) {
  if (!m) return false;
  const type = String(m.priceType || '').toLowerCase();
  const note = `${m.note || ''} ${m.title || ''}`.toLowerCase();
  const fromTcg = String(m.source || '').toLowerCase() === 'tcgplayer';
  if (type === 'market' && (fromTcg || /tcgplayer/.test(note))) return true;
  if (fromTcg && /market\s*price|precio\s*(de\s*)?mercado/.test(note)) return true;
  return false;
}

/**
 * Elige la coincidencia de referencia TCG: Market Price TCGPlayer.
 * @param {MarketMatch[]} matches
 */
export function pickTcgReferenceMatch(matches) {
  const list = matches || [];
  const market = list.filter(isTcgMarketPriceMatch);
  if (market.length) {
    return [...market].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  }
  const tcg = list.filter((m) => String(m.source || '').toLowerCase() === 'tcgplayer');
  if (tcg.length) {
    return [...tcg].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  }
  return list[0] || null;
}

async function fetchImageAsInlinePart(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) return null;
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  const mime = blob.type || 'image/jpeg';
  return { inline_data: { mime_type: mime, data: b64 } };
}

function parseJsonObject(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/**
 * @param {MarketMatch[]} a
 * @param {MarketMatch[]} b
 */
export function mergeMatches(a, b) {
  const out = [...(a || [])];
  const key = (m) => `${String(m.title || '').toLowerCase().slice(0, 60)}|${Number(m.price).toFixed(2)}`;
  const seen = new Set(out.map(key));
  for (const m of b || []) {
    if (!m || !Number.isFinite(Number(m.price))) continue;
    const k = key(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

/**
 * @param {MarketMatch[]} matches
 * @param {object} item
 */
export function scoreAndSortMatches(matches, item) {
  const tokens = [
    item?.series, item?.character_name, item?.character, item?.manufacturer,
    item?.item_number, item?.franchise, ...(String(item?.name || '').split(/\s+/))
  ]
    .map((t) => String(t || '').toLowerCase())
    .filter((t) => t.length > 2);

  return [...(matches || [])]
    .map((m) => {
      const title = String(m.title || '').toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (title.includes(t.toLowerCase())) score += 2;
      }
      if (m.source === 'tcgplayer') score += 2;
      if (m.source === 'ebay' || m.source === 'cardmarket') score += 1;
      if (isTcgMarketPriceMatch(m)) score += 5;
      if (m.url) score += 0.5;
      return { ...m, score };
    })
    .sort((a, b) => (b.score - a.score) || (a.price - b.price));
}

async function searchPricesViaWebIndex(query, limit = 8) {
  const qCard = encodeURIComponent(`${query} TCGPlayer "Market Price"`);
  const qFig = encodeURIComponent(`${query} figure price ebay OR amazon`);
  const targets = [
    `https://r.jina.ai/http://www.bing.com/search?q=${qCard}`,
    `https://r.jina.ai/http://www.bing.com/search?q=${qFig}`,
    `https://r.jina.ai/http://html.duckduckgo.com/html/?q=${qCard}`
  ];
  const out = [];
  for (const url of targets) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const text = await res.text();
      const pairRe = /([A-Za-z0-9][^$\n]{8,100}?)\s+\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g;
      let m;
      while ((m = pairRe.exec(text)) !== null && out.length < limit) {
        const title = m[1].replace(/\s+/g, ' ').trim();
        const price = Number(String(m[2]).replace(/,/g, ''));
        if (!Number.isFinite(price) || price < 0.25 || price > 20000) continue;
        if (/cookie|privacy|sign in|results|filter/i.test(title)) continue;
        const isTcg = /tcg|cardmarket|pricecharting|pokemon|yugioh|mtg/i.test(title + url);
        const source = isTcg ? 'tcgplayer' : 'ebay';
        out.push({
          id: `web-${out.length}-${price}`,
          title: title.slice(0, 160),
          price,
          currency: 'USD',
          source,
          query,
          note: isTcg ? 'Precio visto (TCG / web)' : 'Precio visto en búsqueda web',
          url: storeLinkForMatch({ source, title: title.slice(0, 160), query })
        });
      }
      if (out.length) break;
    } catch {
      // next
    }
  }
  return out;
}

function pickMedian(nums) {
  const s = [...nums].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
}

// Re-export helpers used by tests / callers
export { extractEbayListings, extractEbayPrices };
