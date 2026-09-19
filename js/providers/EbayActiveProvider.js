import { MarketPriceProvider } from './MarketPriceProvider.js';
import { ebayMarketUrls } from './EbayLinkProvider.js';

/**
 * Intenta leer precios de anuncios activos en eBay US (Buy It Now).
 * No usa vendidos: desde 2026 eBay pide login para LH_Sold.
 * Pasa por proxies CORS públicos; si fallan, la UI sigue con enlaces.
 */
export class EbayActiveProvider extends MarketPriceProvider {
  get id() {
    return 'ebay-us-active';
  }

  get label() {
    return 'eBay US (en venta)';
  }

  /**
   * @param {{ query: string, limit?: number }} opts
   */
  async lookup(opts) {
    const query = (opts.query || '').trim();
    if (!query) throw new Error('Falta el nombre para buscar en eBay');

    const urls = ebayMarketUrls(query);
    const searchUrl = urls.active;
    const html = await fetchHtmlViaProxy(searchUrl);
    const prices = extractEbayPrices(html);
    const stats = summarize(prices);
    const listings = extractEbayListings(html, opts.limit || 8);

    return {
      source: this.id,
      label: this.label,
      currency: 'USD',
      sampleSize: stats.count,
      low: stats.low,
      median: stats.median,
      high: stats.high,
      listings,
      searchUrl,
      soldUrl: urls.sold,
      note: stats.count
        ? `Mediana de ${stats.count} anuncios Buy It Now en eBay US (precio pedido, no ventas cerradas). Para vendidos abre el enlace de eBay.`
        : 'No se pudieron leer precios desde eBay automáticamente. Usa los enlaces de vendidos / en venta.'
    };
  }
}

function summarize(prices) {
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

async function fetchHtmlViaProxy(targetUrl) {
  const proxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`
  ];
  let lastErr = null;
  for (const build of proxies) {
    try {
      const res = await fetch(build(targetUrl), {
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.length < 400) throw new Error('Respuesta vacía');
      if (/signin\.ebay\.com|splashui\/challenge/i.test(text) && !/s-item__price/i.test(text)) {
        throw new Error('eBay bloqueó la consulta automática');
      }
      return text;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No se pudo consultar eBay');
}

/**
 * Extrae montos en USD del HTML de resultados eBay.
 * @param {string} html
 * @returns {number[]}
 */
export function extractEbayPrices(html) {
  if (!html) return [];
  const found = [];
  const reClass = /s-item__price[^>]*>\s*(?:<!--.*?-->\s*)*(?:US\s*)?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi;
  let m;
  while ((m = reClass.exec(html)) !== null) {
    const n = parseMoney(m[1]);
    if (n != null) found.push(n);
  }
  if (found.length >= 3) return dedupeNear(found);

  const reGeneric = /(?:US\s*)?\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g;
  while ((m = reGeneric.exec(html)) !== null) {
    const n = parseMoney(m[1]);
    if (n != null && n >= 5 && n <= 50000) found.push(n);
  }
  return dedupeNear(found).slice(0, 40);
}

/**
 * @param {string} html
 * @param {number} limit
 */
export function extractEbayListings(html, limit = 8) {
  if (!html) return [];
  const out = [];
  const blockRe = /s-item__title[^>]*>[\s\S]*?<span[^>]*>([^<]{8,180})<\/span>[\s\S]*?s-item__price[^>]*>\s*(?:<!--.*?-->\s*)*(?:US\s*)?\$?\s*([0-9,]+\.?[0-9]*)/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null && out.length < limit) {
    const title = m[1].replace(/\s+/g, ' ').trim();
    if (/shop on ebay/i.test(title)) continue;
    const price = parseMoney(m[2]);
    if (price == null) continue;
    out.push({ title, price, currency: 'USD', url: '', condition: undefined });
  }
  return out;
}

function parseMoney(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dedupeNear(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const out = [];
  for (const n of sorted) {
    if (!out.length || Math.abs(out[out.length - 1] - n) > 0.009) out.push(n);
  }
  return out;
}
