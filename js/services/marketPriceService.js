import { EbayActiveProvider } from '../providers/EbayActiveProvider.js';
import { buildMarketLinks, ebayMarketUrls } from '../providers/EbayLinkProvider.js';

const cfg = () => window.APP_CONFIG || {};

/**
 * Consulta de mercado a partir de los campos de la pieza.
 * @param {object} item
 * @returns {string}
 */
export function buildMarketQuery(item) {
  if (!item || typeof item !== 'object') return '';
  const parts = [];
  const manufacturer = cleanPart(item.manufacturer);
  const itemNumber = cleanPart(item.item_number);
  const name = cleanPart(item.name);
  const character = cleanPart(item.character_name || item.character);
  const franchise = cleanPart(item.franchise);
  const series = cleanPart(item.series);

  if (manufacturer) parts.push(manufacturer);
  if (itemNumber) parts.push(itemNumber);
  if (name) parts.push(name);
  else if (character) parts.push(character);
  if (franchise && !name?.toLowerCase().includes(franchise.toLowerCase())) parts.push(franchise);
  if (series && series.length <= 40) parts.push(series);

  const seen = new Set();
  const unique = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique.join(' ').replace(/\s+/g, ' ').trim();
}

function cleanPart(v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
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
      label: 'Sin referencia',
      detail: 'Aún no hay mediana de mercado. Consulta eBay o guarda un estimado.',
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

/**
 * @param {object} item
 * @param {{ query?: string, limit?: number, persist?: boolean }} [options]
 */
export async function lookupMarketPrice(item, options = {}) {
  const query = (options.query || buildMarketQuery(item)).trim();
  if (!query) throw new Error('No hay nombre suficiente para buscar precio');

  const links = filterLinks(buildMarketLinks(query));
  const ebay = ebayMarketUrls(query);

  /** @type {Awaited<ReturnType<EbayActiveProvider['lookup']>> | null} */
  let live = null;
  let liveError = null;
  try {
    live = await new EbayActiveProvider().lookup({ query, limit: options.limit || 12 });
  } catch (err) {
    liveError = err?.message || String(err);
  }

  const result = {
    query,
    source: live?.source || 'market-links',
    label: live?.label || 'Mercados US / JP',
    currency: live?.currency || 'USD',
    sampleSize: live?.sampleSize || 0,
    low: live?.low ?? null,
    median: live?.median ?? null,
    high: live?.high ?? null,
    listings: live?.listings || [],
    searchUrl: live?.searchUrl || ebay.active,
    soldUrl: live?.soldUrl || ebay.sold,
    links,
    ebay,
    note: live?.note
      || (liveError
        ? `Consulta automática de eBay no disponible (${liveError}). Usa los enlaces US/JP; lo más fiable son los vendidos de eBay.`
        : 'Abre eBay vendidos (US) o Yahoo/Mercari/Mandarake (JP) para comparar.'),
    deal: classifyDeal(item?.purchase_price, live?.median),
    checkedAt: new Date().toISOString(),
    liveError
  };

  if (options.persist && item?.id && result.median != null) {
    try {
      const { updateItem } = await import('./collectionService.js');
      await updateItem(item.id, {
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
      // Columnas de mercado pueden faltar hasta que corras el SQL.
    }
  }

  return result;
}

function filterLinks(links) {
  const mode = (cfg().MARKET_REGIONS || 'US,JP').toUpperCase();
  const wantUs = mode.includes('US');
  const wantJp = mode.includes('JP');
  return links.filter((l) => (l.region === 'US' && wantUs) || (l.region === 'JP' && wantJp));
}

/**
 * @param {object} item
 * @param {number} median
 * @param {{ low?: number, high?: number, currency?: string, query?: string }} [extra]
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
    fromCache: true
  };
}

/**
 * @param {object} item
 */
export function cachedMarketFromItem(item) {
  if (!item || item.market_price_median == null) return null;
  const query = item.market_query || buildMarketQuery(item);
  return {
    source: item.market_source || 'cache',
    label: item.market_source === 'manual' ? 'Estimado manual' : 'Última consulta',
    currency: item.market_currency || item.currency || 'USD',
    sampleSize: item.market_sample_size || 0,
    low: item.market_price_low != null ? Number(item.market_price_low) : null,
    median: Number(item.market_price_median),
    high: item.market_price_high != null ? Number(item.market_price_high) : null,
    listings: [],
    links: filterLinks(buildMarketLinks(query)),
    ebay: ebayMarketUrls(query),
    searchUrl: ebayMarketUrls(query).active,
    soldUrl: ebayMarketUrls(query).sold,
    query,
    deal: classifyDeal(item.purchase_price, item.market_price_median),
    checkedAt: item.market_checked_at || null,
    fromCache: true,
    note: 'Datos guardados. Actualiza o revisa los enlaces US/JP.'
  };
}
