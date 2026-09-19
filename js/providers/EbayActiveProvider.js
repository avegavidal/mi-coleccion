import { MarketPriceProvider } from './MarketPriceProvider.js';
import { ebayMarketUrls } from './EbayLinkProvider.js';

/**
 * Lee precios de anuncios activos en eBay US (Buy It Now).
 * Usa varios proxies; si fallan, la UI puede caer a Gemini / enlaces.
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
        ? `Mediana de ${stats.count} anuncios Buy It Now en eBay US.`
        : 'No se pudieron leer precios desde eBay automáticamente.'
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
  const bare = String(targetUrl).replace(/^https?:\/\//, '');
  const proxies = [
    (u) => `https://r.jina.ai/http://${String(u).replace(/^https?:\/\//, '')}`,
    (u) => `https://r.jina.ai/https://${String(u).replace(/^https?:\/\//, '')}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
  ];
  let lastErr = null;
  for (const build of proxies) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(build(targetUrl), {
        signal: ctrl.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
        }
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.length < 200) throw new Error('Respuesta vacía');
      if (/signin\.ebay\.com|splashui\/challenge|captcha/i.test(text) && !/\$\s?\d/.test(text)) {
        throw new Error('eBay bloqueó la consulta automática');
      }
      // jina a veces devuelve markdown con precios
      if (extractEbayPrices(text).length || extractEbayListings(text, 3).length || /\$\d+/.test(text)) {
        return text;
      }
      // aceptar HTML largo aunque el parser sea débil
      if (text.length > 5000) return text;
      throw new Error('Sin precios en la respuesta');
    } catch (err) {
      lastErr = err;
    }
  }
  void bare;
  throw lastErr || new Error('No se pudo consultar eBay');
}

/**
 * Extrae montos en USD del HTML/markdown de resultados eBay.
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

  // Fallback markdown/jina: Title .... $12.99
  if (out.length < 2) {
    const mdRe = /(?:^|\n)\s*(?:#{1,3}\s*)?([A-Za-z0-9][^$\n]{10,120}?)\s+\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g;
    while ((m = mdRe.exec(html)) !== null && out.length < limit) {
      const title = m[1].replace(/\s+/g, ' ').trim();
      if (/ebay|results|filter|shipping/i.test(title) && title.length < 20) continue;
      const price = parseMoney(m[2]);
      if (price == null || price < 5) continue;
      out.push({ title: title.slice(0, 160), price, currency: 'USD', url: '' });
    }
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
