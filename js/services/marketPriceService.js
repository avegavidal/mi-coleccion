import { EbayActiveProvider } from '../providers/EbayActiveProvider.js';
import { autoSearchMarketMatches } from '../providers/AutoMarketSearchProvider.js';
import {
  buildMarketLinks,
  buildShopLinksForQuery,
  buildVisualMarketLinks,
  ebayMarketUrls,
  isTcgCardItem
} from '../providers/EbayLinkProvider.js';
import { formatMoneyDual } from '../utils/dom.js';

const cfg = () => globalThis.APP_CONFIG || globalThis.window?.APP_CONFIG || {};

/**
 * Arma un “item” temporal para buscar precio desde Identificar (sin DB).
 * @param {object|null} suggestion  vision/OCR
 * @param {{ strongMatches?: object[], matches?: object[] }|null} result
 */
export function buildMarketProbeFromSuggestion(suggestion, result) {
  const top = result?.strongMatches?.[0] || result?.matches?.[0] || null;
  return {
    name: suggestion?.name || top?.name || '',
    manufacturer: suggestion?.manufacturer || top?.manufacturer || null,
    franchise: suggestion?.franchise || top?.franchise || null,
    series: suggestion?.series || top?.series || null,
    character_name: suggestion?.character_name || top?.character_name || null,
    item_number: suggestion?.item_number || top?.item_number || null,
    category: suggestion?.category || top?.category || null
  };
}

/**
 * Consultas AMPLIAS para marketplaces (nunca el título exacto largo).
 * Prioriza: código+marca, serie+personaje, keywords cortas.
 * @param {object} item
 * @returns {string}
 */
export function buildMarketQuery(item) {
  const queries = buildLooseQueries(item);
  return queries[0] || '';
}

/**
 * @param {object} item
 * @returns {string[]}
 */
export function buildLooseQueries(item) {
  if (!item || typeof item !== 'object') return [];
  const manufacturer = cleanPart(item.manufacturer);
  const itemNumber = cleanPart(item.item_number);
  const franchise = cleanPart(item.franchise);
  const character = cleanPart(item.character_name || item.character);
  const series = cleanPart(item.series);
  const category = cleanPart(item.category);
  const softName = softenTitle(cleanPart(item.name));
  const tcg = isTcgCardItem(item);

  // Orden pensado para marketplaces: serie+personaje suele encontrar más
  // que fabricante+SKU (Amazon a menudo no indexa el número de artículo).
  const candidates = [];
  if (!tcg && series && character) {
    candidates.push(joinUnique([series, character, 'figure']));
  }
  if (series && character) {
    candidates.push(joinUnique([series, character, manufacturer].filter(Boolean)));
  }
  if (softName) candidates.push(softName);
  if (!tcg && softName && !/\b(figure|figura|banpresto|nendoroid)\b/i.test(softName)) {
    candidates.push(`${softName} figure`);
  }
  if (tcg && softName) candidates.push(`${softName} TCG`);
  if (franchise && character) {
    candidates.push(joinUnique(tcg ? [franchise, character] : [franchise, character, 'figure']));
  }
  if (manufacturer && itemNumber) candidates.push(joinUnique([manufacturer, itemNumber]));
  if (itemNumber && (series || franchise || character)) {
    candidates.push(joinUnique([itemNumber, series || franchise || character]));
  }
  if (manufacturer && (character || franchise) && !(series && character)) {
    candidates.push(joinUnique([manufacturer, character || franchise, series].filter(Boolean)));
  }
  if (category && (character || franchise)) {
    candidates.push(joinUnique([category, character || franchise]));
  }
  if (manufacturer && series && !character) {
    candidates.push(joinUnique([manufacturer, series]));
  }

  const seen = new Set();
  const out = [];
  for (const q of candidates) {
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    // Evitar queries casi idénticas (mismo set de palabras)
    const norm = key.split(/\s+/).sort().join(' ');
    if (seen.has(`#${norm}`)) continue;
    seen.add(key);
    seen.add(`#${norm}`);
    out.push(q);
    if (out.length >= 4) break;
  }
  return out;
}

function cleanPart(v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function softenTitle(name) {
  if (!name) return '';
  const stop = new Set(['the', 'and', 'de', 'del', 'la', 'el', 'edition', 'ver', 'version', 'exclusive', 'limited', 'special']);
  return name
    .replace(/[#№]/g, ' ')
    .replace(/\b(ver\.?|version|exclusive|limited|edition|special|dx|re-?run|pre-?order|scale|figure|fig)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stop.has(w.toLowerCase()))
    .slice(0, 4)
    .join(' ');
}

function joinUnique(parts) {
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = String(p || '').toLowerCase();
    if (!p || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {number[]} prices
 */
export function summarizePrices(prices) {
  const nums = (prices || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (!nums.length) return { count: 0, low: null, median: null, high: null };

  let sample = nums;
  if (nums.length >= 8) {
    const cut = Math.max(1, Math.floor(nums.length * 0.1));
    sample = nums.slice(cut, nums.length - cut);
  }

  const mid = Math.floor(sample.length / 2);
  const median = sample.length % 2 === 0
    ? (sample[mid - 1] + sample[mid]) / 2
    : sample[mid];

  return {
    count: nums.length,
    low: sample[0],
    median: Math.round(median * 100) / 100,
    high: sample[sample.length - 1]
  };
}

/**
 * @param {number|null|undefined} purchasePrice
 * @param {number|null|undefined} marketMedian
 */
export function classifyDeal(purchasePrice, marketMedian) {
  const buy = Number(purchasePrice);
  const med = Number(marketMedian);
  if (!Number.isFinite(buy) || buy <= 0) {
    return {
      code: 'unknown_purchase',
      label: 'Sin precio de compra',
      detail: 'Guarda lo que pagaste para ver si tienes ganancia.',
      ratio: null,
      profit: null
    };
  }
  if (!Number.isFinite(med) || med <= 0) {
    return {
      code: 'unknown_market',
      label: 'Falta precio de mercado',
      detail: 'Busca el precio de mercado (o elige una coincidencia) para calcular ganancia.',
      ratio: null,
      profit: null
    };
  }

  const profit = Math.round((med - buy) * 100) / 100;
  const ratio = buy / med;
  const pct = Math.round(Math.abs(1 - ratio) * 100);

  if (profit > 0.5) {
    const tier = ratio <= 0.75 ? 'steal' : ratio <= 0.92 ? 'good' : 'fair';
    return {
      code: tier,
      label: profit >= 1 ? `Ganancia ~${formatMoneyDual(profit, 'USD')}` : 'Ganancia pequeña',
      detail: `Pagaste ${formatMoneyDual(buy, 'USD')} y el mercado está ~${formatMoneyDual(med, 'USD')}. Si vendes cerca de la mediana, ganarías ~${formatMoneyDual(profit, 'USD')} (${pct}% a tu favor).`,
      ratio,
      profit
    };
  }
  if (profit < -0.5) {
    const loss = Math.abs(profit);
    const tier = ratio <= 1.25 ? 'high' : 'expensive';
    return {
      code: tier,
      label: `Pérdida ~${formatMoneyDual(loss, 'USD')}`,
      detail: `Pagaste ${formatMoneyDual(buy, 'USD')} y el mercado está ~${formatMoneyDual(med, 'USD')}. Hoy estarías ~${formatMoneyDual(loss, 'USD')} por debajo (${pct}% arriba del mercado).`,
      ratio,
      profit
    };
  }
  return {
    code: 'fair',
    label: 'Sin ganancia ni pérdida clara',
    detail: `Pagaste ${formatMoneyDual(buy, 'USD')} y el mercado (~${formatMoneyDual(med, 'USD')}) está casi igual.`,
    ratio,
    profit: 0
  };
}

/** Alias claro para la UI */
export function profitSummary(purchasePrice, marketMedian) {
  return classifyDeal(purchasePrice, marketMedian);
}

const MARKET_CACHE_PREFIX = 'mi_coleccion_market_v2_';
/** Caché corta: precios de mercado cambian; 3 días evita anclar un resultado flojo. */
const MARKET_CACHE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * @param {string} itemId
 */
export function loadMarketCache(itemId) {
  if (!itemId) return null;
  try {
    const raw = localStorage.getItem(MARKET_CACHE_PREFIX + itemId);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const t = new Date(data.checkedAt || 0).getTime();
    if (!Number.isFinite(t) || Date.now() - t > MARKET_CACHE_MS) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {string} itemId
 * @param {object} result
 */
export function saveMarketCache(itemId, result) {
  if (!itemId || !result) return;
  // No persistir búsquedas vacías/error (evitar “congelar” un fallo)
  const matches = result.matches || result.listings || [];
  const status = result.status || (matches.length ? 'found' : 'empty');
  if (status !== 'found' || !matches.length) return;
  try {
    const payload = {
      status,
      matches,
      median: result.median ?? null,
      low: result.low ?? null,
      high: result.high ?? null,
      currency: result.currency || 'USD',
      query: result.query || '',
      queries: result.queries || [],
      note: result.note || '',
      source: result.source || 'cache',
      chosenId: result.chosenId || null,
      reliable: Boolean(result.reliable),
      checkedAt: result.checkedAt || new Date().toISOString(),
      auto: true,
      fromCache: true
    };
    localStorage.setItem(MARKET_CACHE_PREFIX + itemId, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}

/**
 * @param {string} itemId
 */
export function clearMarketCache(itemId) {
  if (!itemId) return;
  try {
    localStorage.removeItem(MARKET_CACHE_PREFIX + itemId);
  } catch {
    // ignore
  }
}

/**
 * Resultado listo desde DB + cache local (sin red).
 * @param {object} item
 * @param {{ imageUrl?: string|null }} [opts]
 */
export function getCachedMarketView(item, opts = {}) {
  if (!item?.id) return null;
  const ls = loadMarketCache(item.id);
  const hasDb = item.market_price_median != null;
  if (!ls && !hasDb) return null;

  const base = buildInstantMarket(item, opts);
  const median = item.market_price_median != null
    ? Number(item.market_price_median)
    : (ls?.median != null ? Number(ls.median) : null);
  const matches = Array.isArray(ls?.matches) && ls.matches.length
    ? ls.matches
    : [];

  return {
    ...base,
    ...ls,
    status: matches.length ? 'found' : (median != null ? 'found' : (ls?.status || 'empty')),
    matches,
    median,
    low: item.market_price_low != null ? Number(item.market_price_low) : (ls?.low ?? null),
    high: item.market_price_high != null ? Number(item.market_price_high) : (ls?.high ?? null),
    currency: item.market_currency || ls?.currency || 'USD',
    sampleSize: item.market_sample_size || matches.length || 0,
    query: item.market_query || ls?.query || base.query,
    chosenId: ls?.chosenId || null,
    source: 'cache',
    label: 'Precio en caché',
    auto: true,
    fromCache: true,
    instant: false,
    checkedAt: item.market_checked_at || ls?.checkedAt || null,
    deal: classifyDeal(item.purchase_price, median),
    note: matches.length
      ? `Usando búsqueda guardada (${matches.length} coincidencia${matches.length === 1 ? '' : 's'}). Pulsa “Buscar de nuevo” para actualizar.`
      : (median != null
        ? 'Usando precio guardado. Pulsa “Buscar de nuevo” para actualizar.'
        : ls?.note || '')
  };
}

function filterLinks(links) {
  const mode = (cfg().MARKET_REGIONS || 'US,JP,VIS').toUpperCase();
  const wantUs = mode.includes('US');
  const wantJp = mode.includes('JP');
  const wantVis = mode.includes('VIS') || true; // visual siempre útil
  return links.filter((l) =>
    (l.region === 'US' && wantUs)
    || (l.region === 'JP' && wantJp)
    || (l.region === 'VIS' && wantVis)
  );
}

/**
 * @param {object} item
 * @param {{ imageUrl?: string|null }} [opts]
 */
export function cachedMarketFromItem(item, opts = {}) {
  if (!item || item.market_price_median == null) return null;
  const query = item.market_query || buildMarketQuery(item);
  const imageUrl = opts.imageUrl || null;
  return {
    source: item.market_source || 'cache',
    label: item.market_source === 'manual' ? 'Estimado manual' : 'Última consulta',
    currency: item.market_currency || item.currency || 'USD',
    sampleSize: item.market_sample_size || 0,
    low: item.market_price_low != null ? Number(item.market_price_low) : null,
    median: Number(item.market_price_median),
    high: item.market_price_high != null ? Number(item.market_price_high) : null,
    listings: [],
    links: filterLinks(buildMarketLinks(query, { imageUrl })),
    ebay: ebayMarketUrls(query),
    searchUrl: ebayMarketUrls(query).active,
    soldUrl: ebayMarketUrls(query).sold,
    query,
    imageUrl,
    deal: classifyDeal(item.purchase_price, item.market_price_median),
    checkedAt: item.market_checked_at || null,
    fromCache: true,
    note: 'Precio guardado. Usa Lens/foto si el nombre no encuentra nada.'
  };
}

/**
 * Snapshot: foto primero + 1–3 búsquedas amplias (no título exacto).
 * @param {object} item
 * @param {{ imageUrl?: string|null }} [opts]
 */
export function buildInstantMarket(item, opts = {}) {
  const queries = buildLooseQueries(item);
  const query = queries[0] || '';
  const imageUrl = opts.imageUrl || null;
  const tcg = isTcgCardItem(item);
  const visual = buildVisualMarketLinks(imageUrl);
  const shopPrimary = query
    ? filterLinks(buildShopLinksForQuery(query, { tcg })).slice(0, tcg ? 8 : 6)
    : [];
  const preferredIds = tcg
    ? ['tcgplayer', 'cardmarket', 'pricecharting', 'ebay-sold']
    : ['ebay-sold', 'amazon-us', 'amazon-jp', 'amiami', 'mercari-us', 'yahoo-jp'];
  const queryGroups = queries.map((q) => ({
    query: q,
    links: filterLinks(buildShopLinksForQuery(q, { tcg })).filter((l) => preferredIds.includes(l.id))
  }));
  const ebay = ebayMarketUrls(query);
  const cached = item?.market_price_median != null
    ? {
      median: Number(item.market_price_median),
      low: item.market_price_low != null ? Number(item.market_price_low) : null,
      high: item.market_price_high != null ? Number(item.market_price_high) : null,
      currency: item.market_currency || item.currency || 'USD',
      checkedAt: item.market_checked_at || null,
      fromCache: true
    }
    : null;

  return {
    query,
    queries,
    queryGroups,
    imageUrl,
    source: 'photo-first',
    label: 'Buscar por foto',
    currency: cached?.currency || item?.currency || 'USD',
    sampleSize: 0,
    low: cached?.low ?? null,
    median: cached?.median ?? null,
    high: cached?.high ?? null,
    listings: [],
    searchUrl: ebay.active,
    soldUrl: ebay.sold,
    links: [...visual, ...shopPrimary],
    visualLinks: visual,
    ebay,
    note: imageUrl
      ? '1) Abre “Buscar precio por foto”. 2) Mira precios parecidos. 3) Guarda la mediana abajo.'
      : 'Agrega una foto a la pieza para buscar por imagen. Mientras, usa las búsquedas amplias.',
    deal: classifyDeal(item?.purchase_price, cached?.median),
    checkedAt: cached?.checkedAt || new Date().toISOString(),
    instant: true,
    fromCache: Boolean(cached)
  };
}

/**
 * Búsqueda AUTOMÁTICA de precios (Gemini web + eBay). Devuelve matches seleccionables.
 * @param {object} item
 * @param {{ query?: string, persist?: boolean, scrape?: boolean, imageUrl?: string|null, onProgress?: Function }} [options]
 */
export async function lookupMarketPrice(item, options = {}) {
  const baseItem = options.query
    ? { ...item, name: options.query, market_query: options.query }
    : item;

  const imageUrl = options.imageUrl || null;
  const auto = await autoSearchMarketMatches(baseItem, {
    imageUrl,
    imageBlob: options.imageBlob || null,
    onProgress: options.onProgress,
    signal: options.signal,
    maxAttempts: options.maxAttempts,
    limit: 12
  });

  const result = {
    ...buildInstantMarket(baseItem, { imageUrl }),
    source: auto.matches.some((m) => m.source === 'ebay') ? 'auto-ebay' : 'auto-search',
    label: auto.status === 'found' ? 'Coincidencias de mercado' : 'Sin coincidencias automáticas',
    status: auto.status,
    matches: auto.matches,
    listings: auto.matches.map((m) => ({
      title: m.title,
      price: m.price,
      currency: m.currency,
      url: m.url || ''
    })),
    sampleSize: auto.sampleSize,
    low: auto.low,
    median: auto.median,
    high: auto.high,
    currency: auto.currency || 'USD',
    note: auto.note,
    errors: auto.errors,
    reliable: Boolean(auto.reliable),
    deal: classifyDeal(item?.purchase_price, auto.median),
    checkedAt: new Date().toISOString(),
    instant: false,
    auto: true
  };

  // Fallback scrape explícito (legacy)
  if (options.scrape && (!auto.matches || !auto.matches.length)) {
    try {
      const query = result.query || buildMarketQuery(item);
      const live = await Promise.race([
        new EbayActiveProvider().lookup({ query, limit: 8 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      ]);
      if (live?.median != null) {
        result.source = live.source;
        result.label = live.label;
        result.currency = live.currency;
        result.sampleSize = live.sampleSize;
        result.low = live.low;
        result.median = live.median;
        result.high = live.high;
        result.listings = live.listings || [];
        result.note = live.note;
        result.deal = classifyDeal(item?.purchase_price, live.median);
        result.status = (live.listings || []).length || live.median != null ? 'found' : 'empty';
      }
    } catch {
      // mantener auto result
    }
  }

  if (options.persist && item?.id && result.median != null && auto.matches.length === 1) {
    await persistMarket(item.id, result, result.query);
  }

  if (item?.id) saveMarketCache(item.id, result);

  return result;
}

/** Alias claro para la UI */
export async function ensureMarketPrice(item, opts = {}) {
  const hasPhoto = Boolean(opts.imageUrl);
  if (!buildMarketQuery(item) && item?.market_price_median == null && !hasPhoto) {
    throw new Error('Agrega una foto o algunos datos (marca, serie, personaje) para buscar precio');
  }
  return lookupMarketPrice(item, opts);
}

async function persistMarket(itemId, result, query) {
  try {
    const { updateItem } = await import('./collectionService.js');
    await updateItem(itemId, {
      market_price_low: result.low,
      market_price_median: result.median,
      market_price_high: result.high,
      market_sample_size: result.sampleSize,
      market_currency: result.currency,
      market_source: result.source,
      market_query: query,
      market_checked_at: result.checkedAt
    });
  } catch {
    // noop
  }
}

/**
 * @param {object} item
 * @param {number} median
 * @param {{ low?: number, high?: number, currency?: string, query?: string, sampleSize?: number }} [extra]
 */
export async function saveManualMarketPrice(item, median, extra = {}) {
  if (!item?.id) throw new Error('Pieza inválida');
  const med = Number(median);
  if (!Number.isFinite(med) || med <= 0) throw new Error('Precio de mercado inválido');

  const { updateItem } = await import('./collectionService.js');
  const query = extra.query || buildMarketQuery(item);
  const payload = {
    market_price_median: med,
    market_price_low: extra.low != null ? Number(extra.low) : med,
    market_price_high: extra.high != null ? Number(extra.high) : med,
    market_sample_size: extra.sampleSize != null ? Number(extra.sampleSize) : 1,
    market_currency: extra.currency || 'USD',
    market_source: 'manual',
    market_query: query,
    market_checked_at: new Date().toISOString()
  };
  await updateItem(item.id, payload);
  const out = {
    ...payload,
    source: 'manual',
    label: 'Estimado manual',
    currency: payload.market_currency,
    sampleSize: payload.market_sample_size,
    low: payload.market_price_low,
    median: payload.market_price_median,
    high: payload.market_price_high,
    listings: [],
    links: filterLinks(buildMarketLinks(query)),
    ebay: ebayMarketUrls(query),
    query,
    deal: classifyDeal(item.purchase_price, med),
    checkedAt: payload.market_checked_at,
    note: 'Precio que guardaste tras revisar eBay / Japón.',
    fromCache: true,
    instant: true,
    status: 'found',
    matches: [],
    auto: true
  };
  saveMarketCache(item.id, {
    ...loadMarketCache(item.id),
    ...out,
    matches: loadMarketCache(item.id)?.matches || [],
    chosenId: extra.chosenId || loadMarketCache(item.id)?.chosenId || null
  });
  return out;
}

const MARKET_FRESH_MS = 30 * 24 * 60 * 60 * 1000;

export function isMarketFresh(item) {
  if (!item?.id) return false;
  if (loadMarketCache(item.id)) return true;
  if (!item?.market_checked_at || item.market_price_median == null) return false;
  const t = new Date(item.market_checked_at).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < MARKET_FRESH_MS;
}
