/**
 * Búsqueda automática de precios de mercado.
 * 1) Gemini + Google Search (si hay API key) → coincidencias con precio
 * 2) eBay vía proxies (fallback)
 * Devuelve matches seleccionables; no solo enlaces.
 */

import { EbayActiveProvider, extractEbayListings, extractEbayPrices } from './EbayActiveProvider.js';
import { ebayMarketUrls, buildShopLinksForQuery, buildVisualMarketLinks, isTcgCardItem, buildTcgShopLinks } from './EbayLinkProvider.js';

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

/**
 * @param {object} item
 * @param {{ imageUrl?: string|null, onProgress?: (p:{stage:string,message:string})=>void, limit?: number }} [opts]
 */
export async function autoSearchMarketMatches(item, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const limit = opts.limit || 12;
  const queries = buildSearchQueries(item);
  const imageUrl = opts.imageUrl || null;
  /** @type {MarketMatch[]} */
  let matches = [];
  const errors = [];

  // 1) Gemini + Google Search (live web) — principal
  const apiKey = readGeminiApiKey();
  if (apiKey) {
    onProgress({ stage: 'gemini', message: 'Buscando precio en la web con IA…' });
    try {
      const geminiMatches = await searchMarketWithGemini(item, {
        apiKey,
        imageUrl,
        queries,
        limit
      });
      matches = mergeMatches(matches, geminiMatches);
    } catch (err) {
      errors.push(`Gemini: ${err.message}`);
      onProgress({ stage: 'gemini', message: `IA no pudo buscar (${err.message}). Probando otras fuentes…` });
    }
  } else {
    errors.push('Sin Gemini API key: ve a Configuración y guárdala para precios automáticos.');
    onProgress({ stage: 'gemini', message: 'Sin API key de Gemini — precios automáticos limitados…' });
  }

  // 2) eBay scrape por cada query amplia
  if (matches.length < 3 && queries.length) {
    onProgress({ stage: 'ebay', message: 'Consultando eBay automáticamente…' });
    const provider = new EbayActiveProvider();
    for (const q of queries.slice(0, 3)) {
      if (matches.length >= limit) break;
      try {
        const live = await Promise.race([
          provider.lookup({ query: q, limit: 8 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout eBay')), 14000))
        ]);
        const fromListings = (live.listings || []).map((l, i) => ({
          id: `ebay-${q}-${i}-${l.price}`,
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
              id: `ebay-stat-${q}-${label}-${price}`,
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

  // 3) Bing/DDG vía Jina si aún no hay matches
  if (matches.length < 2 && queries[0]) {
    onProgress({ stage: 'web', message: 'Buscando precios en la web…' });
    try {
      const webMatches = await searchPricesViaWebIndex(queries[0], limit);
      matches = mergeMatches(matches, webMatches);
    } catch (err) {
      errors.push(`Web: ${err.message}`);
    }
  }

  matches = scoreAndSortMatches(matches, item).slice(0, limit);

  const tcg = isTcgCardItem(item);
  if (tcg) {
    // Market Price primero en la lista
    matches = [...matches].sort((a, b) => {
      const aM = isTcgMarketPriceMatch(a) ? 1 : 0;
      const bM = isTcgMarketPriceMatch(b) ? 1 : 0;
      if (bM !== aM) return bM - aM;
      return (b.score || 0) - (a.score || 0);
    });
  }

  const status = matches.length
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
    matches,
    queries,
    query: primaryQuery,
    imageUrl,
    errors,
    tcg,
    reference: tcg ? 'tcgplayer-market' : 'median',
    referenceMatchId: ref?.id || null,
    sampleSize: matches.length,
    low: matches.length ? Math.min(...matches.map((m) => m.price)) : null,
    median,
    high: matches.length ? Math.max(...matches.map((m) => m.price)) : null,
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
      : !readGeminiApiKey()
        ? 'Para precios automáticos: Configuración → pega tu Gemini API key. Sin ella los marketplaces bloquean la lectura automática.'
      : status === 'empty'
        ? 'No encontré precios automáticos para esta pieza. Revisa los datos o abre un buscador manual.'
        : `No pude leer el mercado automáticamente (${errors[0] || 'error'}). Puedes reintentar o abrir un buscador.`
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
 * @param {{ apiKey: string, imageUrl?: string|null, queries: string[], limit?: number }} opts
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
- price must be a number in USD when possible (convert EUR if needed; note original).
- Include 1–8 matches if found; empty array if none.
- Do NOT invent URLs; omit url if unknown.
${tcg
    ? `- CRITICAL: at least one match MUST be TCGPlayer Market Price when available, with "source":"tcgplayer" and "priceType":"market" and note "TCGPlayer Market Price".
- Prefer Near Mint Market Price; put foil / alternate art as separate matches.
- Do NOT use Low Price as the main reference.`
    : '- If multiple variants exist, include several so the user can pick the ideal one.'}
- If live data is unavailable, return 2–5 realistic estimates and set priceType to "estimate".`;

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
    resolveGeminiModels,
    formatGeminiHttpError
  } = await import('../services/geminiClient.js');
  const models = await resolveGeminiModels(apiKey);
  let lastErr = '';
  let data = null;

  // Una sola petición con grounding; si falla por tools → plain. No cascada de modelos.
  const model = models[0] || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const bodyWithTools = {
    contents: [{ parts }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 }
  };
  const bodyPlain = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.2 }
  };

  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyWithTools)
  });

  if (!res.ok) {
    const errText = await res.text();
    lastErr = errText;
    if (res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(errText)) {
      throw new Error(formatGeminiHttpError(429, errText));
    }
    if (res.status === 400 || res.status === 404 || /google_search|tool|Unknown name/i.test(errText)) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPlain)
      });
    }
  }

  if (!res.ok) {
    lastErr = await res.text();
    if (res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(lastErr)) {
      throw new Error(formatGeminiHttpError(429, lastErr));
    }
    // Último recurso: helper (otro modelo a lo sumo)
    try {
      const out = await geminiGenerateContent(apiKey, bodyPlain);
      data = out.data;
    } catch (err) {
      throw new Error(String(err.message || lastErr).slice(0, 280));
    }
  } else {
    data = await res.json();
  }

  const text = geminiTextFromResponse(data);
  return parseGeminiMarketMatches(text, searchHint);
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
    out.push({
      id: `gem-${i}-${price}-${String(m.title || '').slice(0, 24)}`,
      title: String(m.title || searchHint || 'Coincidencia').trim(),
      price,
      currency: String(m.currency || 'USD').toUpperCase() === 'USD' ? 'USD' : String(m.currency || 'USD'),
      source: String(m.source || 'web'),
      priceType: String(m.priceType || inferPriceType(m)).toLowerCase(),
      url: typeof m.url === 'string' && m.url.startsWith('http') ? m.url : undefined,
      query: searchHint,
      note: m.note
        ? String(m.note)
        : (String(m.priceType || '').toLowerCase() === 'market'
          ? 'TCGPlayer Market Price'
          : 'Encontrado por búsqueda web (IA)')
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
        out.push({
          id: `web-${out.length}-${price}`,
          title: title.slice(0, 160),
          price,
          currency: 'USD',
          source: isTcg ? 'tcgplayer' : 'web',
          query,
          note: isTcg ? 'Precio visto (TCG / web)' : 'Precio visto en búsqueda web',
          url: buildTcgShopLinks(query)[0]?.url
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
