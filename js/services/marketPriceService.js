import { EbayActiveProvider } from '../providers/EbayActiveProvider.js';
import {
  buildMarketLinks,
  buildShopLinksForQuery,
  buildVisualMarketLinks,
  ebayMarketUrls
} from '../providers/EbayLinkProvider.js';

const cfg = () => globalThis.APP_CONFIG || globalThis.window?.APP_CONFIG || {};

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

  // Orden pensado para marketplaces: serie+personaje suele encontrar más
  // que fabricante+SKU (Amazon a menudo no indexa el número de artículo).
  const candidates = [];
  if (series && character) {
    candidates.push(joinUnique([series, character, manufacturer].filter(Boolean)));
  }
  if (softName) candidates.push(softName);
  if (franchise && character) candidates.push(joinUnique([franchise, character]));
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
    if (out.length >= 3) break;
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
      detail: 'Guarda lo que pagaste para saber si fue buen trato.',
      ratio: null
    };
  }
  if (!Number.isFinite(med) || med <= 0) {
    return {
      code: 'unknown_market',
      label: 'Revisa vendidos',
      detail: 'Abre eBay vendidos, mira 3–5 precios y guárdalos aquí.',
      ratio: null
    };
  }

  const ratio = buy / med;
  if (ratio <= 0.75) {
    return {
      code: 'steal',
      label: 'Excelente precio',
      detail: `Pagaste ~${Math.round((1 - ratio) * 100)}% bajo la mediana del mercado.`,
      ratio
    };
  }
  if (ratio <= 0.92) {
    return {
      code: 'good',
      label: 'Buen precio',
      detail: 'Por debajo del precio típico de anuncios similares.',
      ratio
    };
  }
  if (ratio <= 1.08) {
    return {
      code: 'fair',
      label: 'Precio justo',
      detail: 'Cerca de la mediana del mercado.',
      ratio
    };
  }
  if (ratio <= 1.25) {
    return {
      code: 'high',
      label: 'Un poco alto',
      detail: 'Por encima de lo que suelen pedir por piezas parecidas.',
      ratio
    };
  }
  return {
    code: 'expensive',
    label: 'Caro vs mercado',
    detail: `Pagaste ~${Math.round((ratio - 1) * 100)}% más que la mediana.`,
    ratio
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
  const visual = buildVisualMarketLinks(imageUrl);
  const shopPrimary = query ? filterLinks(buildShopLinksForQuery(query)).slice(0, 6) : [];
  const queryGroups = queries.map((q) => ({
    query: q,
    links: filterLinks(buildShopLinksForQuery(q)).filter((l) =>
      ['ebay-sold', 'amazon-us', 'amazon-jp'].includes(l.id)
    )
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
 * Instantáneo por defecto. Scrape solo con options.scrape (timeout 2.5s).
 * @param {object} item
 * @param {{ query?: string, persist?: boolean, scrape?: boolean }} [options]
 */
export async function lookupMarketPrice(item, options = {}) {
  const baseItem = options.query
    ? { ...item, name: options.query, market_query: options.query }
    : item;
  const result = buildInstantMarket(baseItem);

  if (options.scrape) {
    try {
      const query = result.query || buildMarketQuery(item);
      const live = await Promise.race([
        new EbayActiveProvider().lookup({ query, limit: 8 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))
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
        result.checkedAt = new Date().toISOString();
        result.instant = false;
        if (options.persist && item?.id) {
          await persistMarket(item.id, result, query);
        }
      }
    } catch {
      // Mantener instantáneo
    }
  }

  return result;
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
  return {
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
    instant: true
  };
}

const MARKET_FRESH_MS = 30 * 24 * 60 * 60 * 1000;

export function isMarketFresh(item) {
  if (!item?.market_checked_at || item.market_price_median == null) return false;
  const t = new Date(item.market_checked_at).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < MARKET_FRESH_MS;
}

/** Instantáneo: sin red. Foto + datos sueltos; no exige nombre exacto. */
export async function ensureMarketPrice(item, opts = {}) {
  const hasPhoto = Boolean(opts.imageUrl);
  if (!buildMarketQuery(item) && item?.market_price_median == null && !hasPhoto) {
    throw new Error('Agrega una foto o algunos datos (marca, serie, personaje) para buscar precio');
  }
  return buildInstantMarket(item, opts);
}
