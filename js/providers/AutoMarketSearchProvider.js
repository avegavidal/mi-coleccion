/**
 * Búsqueda automática de precios de mercado.
 * 1) Gemini + Google Search (si hay API key) → coincidencias con precio
 * 2) eBay vía proxies (fallback)
 * Devuelve matches seleccionables; no solo enlaces.
 */

import { EbayActiveProvider, extractEbayListings, extractEbayPrices } from './EbayActiveProvider.js';
import { ebayMarketUrls, buildShopLinksForQuery, buildVisualMarketLinks } from './EbayLinkProvider.js';

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

  const status = matches.length
    ? 'found'
    : (errors.length ? 'error' : 'empty');

  const primaryQuery = queries[0] || '';
  return {
    status,
    matches,
    queries,
    query: primaryQuery,
    imageUrl,
    errors,
    sampleSize: matches.length,
    low: matches.length ? Math.min(...matches.map((m) => m.price)) : null,
    median: matches.length ? pickMedian(matches.map((m) => m.price)) : null,
    high: matches.length ? Math.max(...matches.map((m) => m.price)) : null,
    currency: 'USD',
    links: [
      ...buildVisualMarketLinks(imageUrl),
      ...(primaryQuery ? buildShopLinksForQuery(primaryQuery).filter((l) =>
        ['ebay-sold', 'ebay-active', 'amazon-us', 'amazon-jp'].includes(l.id)
      ) : [])
    ],
    note: status === 'found'
      ? `Encontré ${matches.length} coincidencia${matches.length === 1 ? '' : 's'}. Elige la ideal.`
      : !readGeminiApiKey()
        ? 'Para precios automáticos: Configuración → pega tu Gemini API key. Sin ella los marketplaces bloquean la lectura automática.'
      : status === 'empty'
        ? 'No encontré precios automáticos para esta pieza. Revisa los datos o abre un buscador manual.'
        : `No pude leer el mercado automáticamente (${errors[0] || 'error'}). Puedes reintentar o abrir un buscador.`
  };
}

function buildSearchQueries(item) {
  // Lazy import avoided — duplicate minimal loose query from item fields
  const parts = [];
  const manufacturer = clean(item?.manufacturer);
  const series = clean(item?.series);
  const character = clean(item?.character_name || item?.character);
  const itemNumber = clean(item?.item_number);
  const franchise = clean(item?.franchise);
  const soft = soften(clean(item?.name));

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

  const prompt = `You are a collectible figure market price assistant.
Search the LIVE web for current asking/sold prices (eBay, Amazon, Mercari, AmiAmi, Yahoo Auctions JP, Mandarake) for this figure.
Use the search hints. Prefer listings that match the SAME product (same line/series), not random similar toys.

Item data:
${meta || '(minimal data)'}

Search hints: ${searchHint}

Return ONLY valid JSON (no markdown) with this shape:
{
  "found": true|false,
  "matches": [
    {
      "title": "listing or product title",
      "price": 49.99,
      "currency": "USD",
      "source": "ebay|amazon|mercari|amiami|yahoo|other",
      "url": "https://...",
      "note": "short why it matches"
    }
  ]
}
Rules:
- price must be a number in USD when possible (convert JPY≈price/150 if needed and set currency USD, note original).
- Include 1–8 real matches if found; empty array if none.
- Do NOT invent URLs; omit url if unknown.
- If multiple variants exist, include several so the user can pick the ideal one.
- If live listings are unavailable, still return 2–5 realistic secondary-market USD price options for the closest matching product variants (label note as "estimado de mercado").`;

  const parts = [{ text: prompt }];

  if (opts.imageUrl) {
    try {
      const imgPart = await fetchImageAsInlinePart(opts.imageUrl);
      if (imgPart) parts.push(imgPart);
    } catch {
      // sin foto sigue por texto
    }
  }

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastErr = '';
  let data = null;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ parts }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2 }
    };
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    // Algunas cuentas/modelos no aceptan google_search — reintentar sin tool
    if (!res.ok && (res.status === 400 || res.status === 404)) {
      const errText = await res.text();
      lastErr = errText;
      if (/google_search|tool|Unknown name/i.test(errText)) {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { temperature: 0.2 }
          })
        });
      } else {
        continue;
      }
    }

    if (!res.ok) {
      lastErr = await res.text();
      if (res.status === 404 || res.status === 400) continue;
      throw new Error(`Gemini ${res.status}: ${String(lastErr).slice(0, 160)}`);
    }

    data = await res.json();
    break;
  }

  if (!data) throw new Error(String(lastErr).slice(0, 180) || 'Gemini sin respuesta');

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
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
      url: typeof m.url === 'string' && m.url.startsWith('http') ? m.url : undefined,
      query: searchHint,
      note: m.note ? String(m.note) : 'Encontrado por búsqueda web (IA)'
    });
  }
  return out;
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
      if (m.source === 'ebay') score += 1;
      if (m.url) score += 0.5;
      return { ...m, score };
    })
    .sort((a, b) => (b.score - a.score) || (a.price - b.price));
}

async function searchPricesViaWebIndex(query, limit = 8) {
  const q = encodeURIComponent(`${query} figure price ebay OR amazon`);
  const targets = [
    `https://r.jina.ai/http://www.bing.com/search?q=${q}`,
    `https://r.jina.ai/http://html.duckduckgo.com/html/?q=${q}`
  ];
  /** @type {import('./AutoMarketSearchProvider.js').MarketMatch[]} */
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
        if (!Number.isFinite(price) || price < 8 || price > 20000) continue;
        if (/cookie|privacy|sign in|results|filter/i.test(title)) continue;
        out.push({
          id: `web-${out.length}-${price}`,
          title: title.slice(0, 160),
          price,
          currency: 'USD',
          source: 'web',
          query,
          note: 'Precio visto en búsqueda web'
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
