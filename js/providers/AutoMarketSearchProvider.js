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
 * Match “sólido” (anuncio exacto / market TCG / buen score).
 * @param {MarketMatch} m
 */
export function isReliableMatch(m) {
  if (!m || !(Number(m.price) > 0)) return false;
  if (m.source === 'web-snippet') return false;
  if (isTcgMarketPriceMatch(m)) return true;
  if (m.linkExact && (m.score == null || m.score >= 1)) return true;
  if ((m.score || 0) >= 3 && m.source !== 'web-snippet') return true;
  if ((m.score || 0) >= 2 && m.priceType !== 'estimate') return true;
  return false;
}

/**
 * ¿Hay coincidencias suficientemente buenas para dejar de reintentar?
 * Figuras: 1 match decente basta (si exigimos URL exacta, nunca termina).
 * @param {MarketMatch[]} matches
 * @param {object} [item]
 */
export function hasReliableMarketMatches(matches, item = null) {
  const list = matches || [];
  if (!list.length) return false;
  const scored = list.some((m) => m.score != null)
    ? list
    : scoreAndSortMatches(list, item || {});
  return shouldStopMarketSearch(scored, item, 99);
}

/**
 * Criterio de parada por intento. Más permisivo en figuras para no loopear vacío.
 * @param {MarketMatch[]} matches
 * @param {object|null} item
 * @param {number} attempt
 */
export function shouldStopMarketSearch(matches, item, attempt = 1) {
  const list = matches || [];
  if (!list.length) return false;
  const scored = list.some((m) => m.score != null)
    ? [...list].sort((a, b) => (b.score || 0) - (a.score || 0))
    : scoreAndSortMatches(list, item || {});

  const usable = scored.filter((m) =>
    Number(m.price) > 0
    && m.source !== 'web-snippet'
    && (m.score || 0) >= 2
  );

  if (isTcgCardItem(item)) {
    if (scored.some(isTcgMarketPriceMatch)) return true;
    if (usable.some((m) => isReliableMatch(m) && /tcgplayer/i.test(String(m.source || '')))) return true;
    // Tras varios intentos, cualquier precio TCGPlayer/carta útil
    if (attempt >= 3 && usable.some((m) => /tcgplayer|cardmarket/i.test(String(m.source || '')))) return true;
    if (attempt >= 5 && usable.length >= 1) return true;
    return false;
  }

  // Figuras / cajas: 1 coincidencia decente → mostrar ya (no exigir /itm/)
  if (usable.length >= 1) return true;
  if (scored.some(isReliableMatch)) return true;
  // Último recurso tras varios intentos: cualquier precio > 0 no-snippet
  if (attempt >= 4 && scored.some((m) => Number(m.price) > 0 && m.source !== 'web-snippet')) return true;
  return false;
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
  // Pocos intentos útiles > loop eterno sin resultados
  const maxAttempts = opts.maxAttempts ?? (apiKey ? 6 : 2);

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
        matches = scoreAndSortMatches(matches, item);
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

    if (shouldStopMarketSearch(matches, item, attempt)) break;

    // 2) eBay
    if (queries.length) {
      onProgress({ stage: 'ebay', attempt, message: `eBay automático (intento ${attempt})…` });
      const provider = new EbayActiveProvider();
      for (const q of queries.slice(0, 3)) {
        if (shouldStopMarketSearch(matches, item, attempt) && matches.length >= 2) break;
        if (signal?.aborted) break;
        try {
          const live = await Promise.race([
            provider.lookup({ query: q, limit: 8 }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout eBay')), 14000))
          ]);
          const fromListings = (live.listings || []).map((l, i) => {
            const url = l.url || '';
            const exact = isDirectListingUrl(url);
            return {
              id: `ebay-${attempt}-${q}-${i}-${l.price}`,
              title: l.title || q,
              price: Number(l.price),
              currency: live.currency || 'USD',
              source: 'ebay',
              priceType: exact ? 'listing' : 'listing',
              linkExact: exact,
              url: url || live.searchUrl || ebayMarketUrls(q).active,
              query: q,
              note: exact ? 'Anuncio eBay (en venta)' : 'Listado eBay'
            };
          });
          if (fromListings.length) {
            matches = mergeMatches(matches, fromListings);
            matches = scoreAndSortMatches(matches, item);
          } else if (live.median != null) {
            // Resumen estadístico: útil como pista, no como “éxito” definitivo
            const synth = [];
            for (const [label, price] of [['eBay bajo', live.low], ['eBay típico', live.median], ['eBay alto', live.high]]) {
              if (price == null) continue;
              synth.push({
                id: `ebay-stat-${attempt}-${q}-${label}-${price}`,
                title: `${label}: ${q}`,
                price: Number(price),
                currency: 'USD',
                source: 'ebay',
                priceType: 'estimate',
                linkExact: false,
                url: live.searchUrl,
                query: q,
                note: live.note || 'Resumen orientativo de precios eBay'
              });
            }
            matches = mergeMatches(matches, synth);
            matches = scoreAndSortMatches(matches, item);
          }
        } catch (err) {
          errors.push(`eBay “${q}”: ${err.message}`);
        }
      }
    }

    if (shouldStopMarketSearch(matches, item, attempt)) break;

    // 3) Índice web solo como último recurso (ruido alto)
    if (queries[0] && attempt >= 2 && !shouldStopMarketSearch(matches, item, attempt)) {
      onProgress({ stage: 'web', attempt, message: `Índice web (último recurso, intento ${attempt})…` });
      try {
        const webMatches = await searchPricesViaWebIndex(queries[0], limit, { tcg: isTcgCardItem(item) });
        matches = mergeMatches(matches, webMatches);
        matches = scoreAndSortMatches(matches, item);
      } catch (err) {
        errors.push(`Web: ${err.message}`);
      }
    }

    if (shouldStopMarketSearch(matches, item, attempt)) break;

    if (attempt >= maxAttempts) break;

    const hasSome = hasUsefulMarketMatches(matches);
    const waitMs = hasSome
      ? Math.min(6000, 1200 * attempt)
      : Math.min(16000, Math.round(1800 * (1.35 ** Math.min(attempt - 1, 5))));
    onProgress({
      stage: 'wait',
      attempt,
      message: hasSome
        ? `Mejorando resultados (${attempt + 1}/${maxAttempts})…`
        : `Aún sin precio. Reintento ${attempt + 1}/${maxAttempts} en ${Math.round(waitMs / 1000)}s…`
    });
    await delay(waitMs, signal);
  }

  matches = scoreAndSortMatches(matches, item);
  matches = flagPriceOutliers(matches);
  matches = filterDisplayMatches(matches, item).slice(0, limit);

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
    : ['ebay-sold', 'ebay-active', 'amazon-us', 'amazon-jp', 'amiami', 'mercari-us', 'yahoo-jp'];

  const ref = tcg ? pickTcgReferenceMatch(matches) : null;
  const refPrice = ref?.price != null ? Number(ref.price) : null;
  const medianPool = matches.filter((m) =>
    m.priceType !== 'estimate' && m.source !== 'web-snippet'
  );
  const medianPrices = (medianPool.length ? medianPool : matches).map((m) => m.price);
  const median = refPrice != null && Number.isFinite(refPrice)
    ? refPrice
    : (medianPrices.length ? pickMedian(medianPrices) : null);

  const reliable = hasReliableMarketMatches(matches, item);
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
    reliable,
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
        : (reliable
          ? `Encontré ${matches.length} coincidencia${matches.length === 1 ? '' : 's'}. Elige la ideal.`
          : `Encontré ${matches.length} pista${matches.length === 1 ? '' : 's'} (algunas orientativas). Revisa o pulsa “Buscar de nuevo”.`))
      : !apiKey
        ? 'Para precios automáticos: Configuración → pega tu Gemini API key. Sin ella los marketplaces bloquean la lectura automática.'
      : status === 'empty'
        ? 'Tras varios intentos no encontré precios útiles. Revisa los datos o abre un buscador manual.'
        : `Tras reintentos no pude leer el mercado (${errors[errors.length - 1] || 'error'}). Puedes pulsar “Buscar de nuevo”.`
  };
}

function buildSearchQueries(item) {
  const manufacturer = clean(item?.manufacturer);
  const series = clean(item?.series);
  const character = clean(item?.character_name || item?.character);
  const itemNumber = clean(item?.item_number);
  const franchise = clean(item?.franchise);
  const soft = soften(clean(item?.name));
  const tcg = isTcgCardItem(item);
  const parts = [];

  if (tcg) {
    if (soft && (series || franchise || itemNumber)) {
      parts.push([soft, series || franchise, itemNumber].filter(Boolean).join(' '));
    }
    if (character && (series || franchise)) parts.push([character, series || franchise].join(' '));
    if (soft) parts.push(`${soft} TCG`);
    if (character && itemNumber) parts.push([character, itemNumber].join(' '));
  } else {
    // Figuras: serie+personaje (+ figure) suele batir al título largo
    if (series && character) {
      parts.push([series, character, 'figure'].join(' '));
      parts.push([series, character, manufacturer].filter(Boolean).join(' '));
    }
    if (manufacturer && character) parts.push([manufacturer, character, 'figure'].join(' '));
    if (soft) parts.push(soft);
    if (soft && !/\b(figure|figura|banpresto|nendoroid|figma|glitter)\b/i.test(soft)) {
      parts.push(`${soft} figure`);
    }
    if (franchise && character) parts.push([franchise, character, 'figure'].join(' '));
    if (manufacturer && itemNumber) parts.push([manufacturer, itemNumber].join(' '));
  }

  const seen = new Set();
  const out = [];
  for (const q of parts) {
    const k = q.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k)) continue;
    const norm = k.split(/\s+/).sort().join(' ');
    if (seen.has(`#${norm}`)) continue;
    seen.add(k);
    seen.add(`#${norm}`);
    out.push(q);
    if (out.length >= 4) break;
  }
  return out;
}

function clean(v) {
  return v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
}

function soften(name) {
  if (!name) return '';
  return name
    .replace(/\b(ver\.?|version|exclusive|limited|edition|special|dx|pre-?order|re-?run)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s\-&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 6)
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
    item?.franchise && `Franchise: ${item.franchise}`,
    item?.category && `Category: ${item.category}`
  ].filter(Boolean).join('\n');

  const tcg = isTcgCardItem(item);
  const prompt = `You are a collectible market price assistant (${tcg ? 'TRADING CARD / TCG specialist' : 'ANIME FIGURE / prize figure specialist'}).
${tcg
    ? `For TCG cards, the PRIMARY reference price is TCGPlayer "Market Price" (NOT Low Price, NOT Mid listing, NOT listed asking price).
Search TCGPlayer first and return the Market Price for the exact card (same set + collector number + finish/foil when visible).
You may also include Cardmarket trend / PriceCharting as secondary options, clearly labeled.`
    : `This item is a FIGURE (Banpresto / Bandai Spirits / Good Smile / scale / prize), NOT a trading card.
Search eBay sold/active, AmiAmi, Mercari, Yahoo Auctions JP, Amazon for the FIGURE listing.
DO NOT return TCGPlayer / Cardmarket / PriceCharting card prices even if a same-character TCG card exists.
Include "figure", "Banpresto", or the figure line (e.g. Glitter & Glamours) in the match title when known.`}

Item data:
${meta || '(minimal data)'}

Search hints: ${searchHint}

Return ONLY valid JSON (no markdown) with this shape:
{
  "found": true|false,
  "matches": [
    {
      "title": "product title (figure line + character, or card set/number if card)",
      "price": 49.99,
      "currency": "USD",
      "source": "${tcg ? 'tcgplayer|cardmarket|pricecharting|ebay|other' : 'ebay|amazon|mercari|amiami|yahoo|other'}",
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
- Prefer REAL listing URLs: ebay.com/itm/..., amazon.com/dp/..., mercari.com/item/..., amiami.com/.../detail/...${tcg ? ', tcgplayer.com/product/...' : ''}.
- If you cannot find the listing URL, set priceType to "estimate" and say so in note. Still set source correctly.
${tcg
    ? `- CRITICAL: at least one match MUST be TCGPlayer Market Price when available, with "source":"tcgplayer" and "priceType":"market" and note "TCGPlayer Market Price".
- Prefer Near Mint Market Price; put foil / alternate art as separate matches.
- Do NOT use Low Price as the main reference.`
    : `- If multiple variants exist (A/B colorways, open box vs sealed), include several so the user can pick.
- Never substitute a trading-card price for a figure.`}
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
    generationConfig: { temperature: 0.1 }
  };
  const bodyWithTools = {
    contents: [{ parts }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1 }
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
    // Devolver lo que haya; el loop decide si es fiable o hay que reintentar
    if (parsed.length) return parsed;
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
    // Sin URL de anuncio: mantener listing en tiendas conocidas (la UI marca Orientativo).
    // Solo forzar estimate si la fuente es desconocida o el modelo lo dijo.
    if (!exact && priceType === 'listing') {
      if (!/ebay|amazon|mercari|amiami|yahoo|mandarake|tcgplayer|cardmarket/i.test(source)) {
        priceType = 'estimate';
      }
    }
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
  const tcgItem = isTcgCardItem(item);
  const tokens = [
    item?.series, item?.character_name, item?.character, item?.manufacturer,
    item?.item_number, item?.franchise, ...(String(item?.name || '').split(/\s+/))
  ]
    .map((t) => String(t || '').toLowerCase())
    .filter((t) => t.length > 2);

  return [...(matches || [])]
    .map((m) => {
      const title = String(m.title || '').toLowerCase();
      const src = String(m.source || '').toLowerCase();
      const blob = `${title} ${src} ${m.note || ''}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (title.includes(t.toLowerCase())) score += 2;
      }
      if (m.linkExact || isDirectListingUrl(m.url)) score += 4;
      if (m.priceType === 'estimate') score -= 1;
      if (src === 'web-snippet') score -= 6;
      if (isTcgMarketPriceMatch(m)) score += 6;
      else if (src === 'tcgplayer') score += tcgItem ? 3 : -8;
      if (src === 'ebay' || src === 'amiami' || src === 'mercari' || src === 'yahoo') score += 2;
      if (src === 'amazon') score += 1;
      if (src === 'cardmarket' || src === 'pricecharting') score += tcgItem ? 2 : -8;
      // Penalizar cruce figura ↔ carta
      if (!tcgItem && /tcgplayer|cardmarket|pricecharting|trading\s*card|\bholo\b|\bnm\b\s*market/i.test(blob)) {
        score -= 10;
      }
      if (tcgItem && /\b(banpresto|nendoroid|figma|glitter\s*&?\s*glamours|prize\s*figure|scale\s*figure)\b/i.test(blob)) {
        score -= 8;
      }
      if (!tcgItem && /\b(figure|figura|banpresto|nendoroid|glitter|figma|amiami)\b/i.test(blob)) {
        score += 2;
      }
      return { ...m, score };
    })
    .sort((a, b) => (b.score - a.score) || (a.price - b.price));
}

/**
 * Baja score de precios muy lejos de la mediana (ruido).
 * @param {MarketMatch[]} matches
 */
export function flagPriceOutliers(matches) {
  const list = matches || [];
  const prices = list
    .filter((m) => m.priceType !== 'estimate' && m.source !== 'web-snippet')
    .map((m) => Number(m.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length < 3) return list;
  const med = pickMedian(prices);
  if (!med) return list;
  return list.map((m) => {
    const p = Number(m.price);
    if (!(p > 0)) return m;
    if (p > med * 3.5 || p < med / 3.5) {
      return {
        ...m,
        score: (m.score || 0) - 4,
        note: `${m.note || 'Coincidencia'} · precio atípico vs resto`.trim()
      };
    }
    return m;
  }).sort((a, b) => (b.score || 0) - (a.score || 0) || (a.price - b.price));
}

/**
 * Quita matches irrelevantes si hay mejores; si solo hay flojos, deja los top.
 * @param {MarketMatch[]} matches
 * @param {object} item
 */
export function filterDisplayMatches(matches, item) {
  const list = matches || [];
  if (!list.length) return list;
  const tcgItem = isTcgCardItem(item);
  const filtered = list.filter((m) => {
    const blob = `${m.title || ''} ${m.source || ''} ${m.note || ''}`.toLowerCase();
    if (!tcgItem && /tcgplayer|cardmarket|pricecharting/.test(String(m.source || '').toLowerCase()) && (m.score || 0) < 2) {
      return false;
    }
    if (!tcgItem && /\b(trading\s*card|tcg\s*market)\b/i.test(blob) && (m.score || 0) < 3) {
      return false;
    }
    if ((m.score || 0) < 0 && list.some((x) => (x.score || 0) >= 3)) return false;
    return true;
  });
  const keep = filtered.length ? filtered : list;
  // Si hay al menos un fiable, oculta web-snippet
  if (keep.some(isReliableMatch)) {
    return keep.filter((m) => m.source !== 'web-snippet');
  }
  return keep;
}

async function searchPricesViaWebIndex(query, limit = 8, opts = {}) {
  const tcg = Boolean(opts.tcg);
  const qPrimary = encodeURIComponent(
    tcg ? `${query} TCGPlayer "Market Price"` : `${query} figure price ebay OR amiami OR mercari`
  );
  const qAlt = encodeURIComponent(
    tcg ? `${query} card price` : `${query} Banpresto OR "prize figure" sold`
  );
  const targets = [
    `https://r.jina.ai/http://www.bing.com/search?q=${qPrimary}`,
    `https://r.jina.ai/http://www.bing.com/search?q=${qAlt}`,
    `https://r.jina.ai/http://html.duckduckgo.com/html/?q=${qPrimary}`
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
        // No fingir fuente TCGPlayer: son snippets ruidosos
        out.push({
          id: `web-${out.length}-${price}`,
          title: title.slice(0, 160),
          price,
          currency: 'USD',
          source: 'web-snippet',
          priceType: 'estimate',
          linkExact: false,
          query,
          note: 'Pista web (orientativa)',
          url: storeLinkForMatch({
            source: tcg ? 'tcgplayer' : 'ebay',
            title: title.slice(0, 160),
            query,
            price
          })
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
