/**
 * Lee Market Price real desde páginas de TCGPlayer / PriceCharting (vía proxy).
 * Sin precios inventados ni hardcodeados: solo lo que diga el HTML/markdown scrapeado.
 */
import { storeLinkForMatch } from './EbayLinkProvider.js';

/**
 * @param {string} query
 * @param {{ limit?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ matches: object[], searchUrl: string, note: string }>}
 */
export async function lookupTcgPlayerMarket(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Falta consulta para TCGPlayer');

  const limit = opts.limit ?? 6;
  const searchUrl = `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(q)}&view=grid`;
  const priceChartUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(q)}&type=priced`;

  /** @type {object[]} */
  let matches = [];
  const errors = [];

  // 1) TCGPlayer búsqueda
  try {
    const html = await fetchHtmlViaProxy(searchUrl, opts.signal);
    matches = mergeScraped(matches, extractTcgPlayerMarketMatches(html, q, { searchUrl }));
  } catch (err) {
    errors.push(`TCGPlayer: ${err.message || err}`);
  }

  // 2) Si ya hay product URL, abrir la ficha para el Market Price exacto
  const productUrls = [...new Set(
    matches.map((m) => m.productUrl).filter((u) => /tcgplayer\.com\/product\/\d+/i.test(u || ''))
  )].slice(0, 3);

  for (const productUrl of productUrls) {
    if (matches.some((m) => m.priceVerified && m.url === productUrl)) continue;
    try {
      const page = await fetchHtmlViaProxy(productUrl, opts.signal);
      const fromPage = extractTcgPlayerMarketMatches(page, q, { searchUrl: productUrl, productUrl });
      matches = mergeScraped(matches, fromPage);
    } catch (err) {
      errors.push(`Producto TCG: ${err.message || err}`);
    }
  }

  // 3) PriceCharting (suele mostrar “TCGPlayer $xxx.xx”)
  if (matches.filter((m) => m.priceVerified).length < 1) {
    try {
      const html = await fetchHtmlViaProxy(priceChartUrl, opts.signal);
      matches = mergeScraped(matches, extractPriceChartingTcgMatches(html, q, { searchUrl: priceChartUrl }));
    } catch (err) {
      errors.push(`PriceCharting: ${err.message || err}`);
    }
  }

  const verified = matches.filter((m) => m.priceVerified && Number(m.price) > 0);
  const list = (verified.length ? verified : matches)
    .sort((a, b) => (b.priceVerified ? 1 : 0) - (a.priceVerified ? 1 : 0) || a.price - b.price)
    .slice(0, limit);

  return {
    matches: list,
    searchUrl,
    note: list.length
      ? `Leído de la página (${list.filter((m) => m.priceVerified).length} Market Price verificado(s)).`
      : (errors[0] || 'No se pudo leer Market Price de TCGPlayer.'),
    errors
  };
}

/**
 * Parsea Market Price + enlaces de producto desde HTML/markdown de TCGPlayer.
 * @param {string} html
 * @param {string} query
 * @param {{ searchUrl?: string, productUrl?: string }} [ctx]
 */
export function extractTcgPlayerMarketMatches(html, query = '', ctx = {}) {
  if (!html) return [];
  const text = String(html);
  const out = [];
  const seen = new Set();

  // URLs de producto
  const productUrls = [];
  const urlRe = /https?:\/\/(?:www\.)?tcgplayer\.com\/product\/(\d+)[^\s"'<>)]*/gi;
  let um;
  while ((um = urlRe.exec(text)) !== null && productUrls.length < 12) {
    const clean = um[0].replace(/[),.;]+$/, '').split('?')[0];
    if (!productUrls.includes(clean)) productUrls.push(clean);
  }
  // Paths relativos /product/12345
  const pathRe2 = /\/product\/(\d{4,})/gi;
  let pm;
  while ((pm = pathRe2.exec(text)) !== null && productUrls.length < 12) {
    const u = `https://www.tcgplayer.com/product/${pm[1]}`;
    if (!productUrls.includes(u)) productUrls.push(u);
  }

  if (ctx.productUrl && /\/product\/\d+/i.test(ctx.productUrl)) {
    const u = ctx.productUrl.split('?')[0];
    if (!productUrls.includes(u)) productUrls.unshift(u);
  }

  // Market Price cerca del texto (lo que muestra la página)
  const marketHits = [];
  const marketRe = /Market\s*Price[^$€£¥\d]{0,40}(?:US\s*)?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi;
  let m;
  while ((m = marketRe.exec(text)) !== null && marketHits.length < 20) {
    const price = parseMoney(m[1]);
    if (price == null || price < 0.1 || price > 100000) continue;
    const around = text.slice(Math.max(0, m.index - 280), m.index + 220);
    const title = pickNearbyTitle(around, query) || `TCGPlayer · ${query}`.trim();
    const localProduct = /(https?:\/\/(?:www\.)?tcgplayer\.com\/product\/\d+[^\s"'<>)]*)/i.exec(around)
      || /\/product\/(\d{4,})/i.exec(around);
    let productUrl = '';
    if (localProduct) {
      productUrl = localProduct[1]?.startsWith('http')
        ? localProduct[1].replace(/[),.;]+$/, '').split('?')[0]
        : `https://www.tcgplayer.com/product/${localProduct[1]}`;
    }
    marketHits.push({ price, title, productUrl, index: m.index });
  }

  // JSON embebido: "marketPrice":123.45
  const jsonRe = /"marketPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/gi;
  while ((m = jsonRe.exec(text)) !== null && marketHits.length < 24) {
    const price = parseMoney(m[1]);
    if (price == null || price < 0.1) continue;
    marketHits.push({
      price,
      title: pickNearbyTitle(text.slice(Math.max(0, m.index - 200), m.index + 80), query) || query,
      productUrl: '',
      index: m.index
    });
  }

  for (let i = 0; i < marketHits.length; i++) {
    const hit = marketHits[i];
    const productUrl = hit.productUrl || productUrls[Math.min(i, productUrls.length - 1)] || '';
    const key = `${hit.price}|${productUrl || hit.title.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const openUrl = productUrl || storeLinkForMatch({
      source: 'tcgplayer',
      title: hit.title,
      query,
      price: hit.price,
      urlTrusted: false
    });
    out.push({
      id: `tcg-scrape-${hit.price}-${i}`,
      title: String(hit.title || query).slice(0, 160),
      price: hit.price,
      currency: 'USD',
      source: 'tcgplayer',
      priceType: 'market',
      priceVerified: true,
      linkExact: Boolean(productUrl),
      urlTrusted: Boolean(productUrl),
      url: openUrl,
      productUrl: productUrl || undefined,
      query,
      note: 'TCGPlayer Market Price (leído de la página)'
    });
  }

  // Si hay productos pero no “Market Price” literal, no inventar: devolver vacío
  return out.slice(0, 10);
}

/**
 * PriceCharting suele listar “TCGPlayer $739.71”.
 * @param {string} html
 * @param {string} query
 * @param {{ searchUrl?: string }} [ctx]
 */
export function extractPriceChartingTcgMatches(html, query = '', ctx = {}) {
  if (!html) return [];
  const text = String(html);
  const out = [];
  const seen = new Set();
  const re = /TCGPlayer[^$\n]{0,48}\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi;
  let m;
  while ((m = re.exec(text)) !== null && out.length < 8) {
    const price = parseMoney(m[1]);
    if (price == null || price < 0.1) continue;
    const around = text.slice(Math.max(0, m.index - 300), m.index + 80);
    const title = pickNearbyTitle(around, query) || query;
    const key = `${price}|${title.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pcUrl = /(https?:\/\/(?:www\.)?pricecharting\.com\/game\/[^\s"'<>)]+)/i.exec(around)?.[1]
      || ctx.searchUrl
      || storeLinkForMatch({ source: 'pricecharting', title, query, price });
    out.push({
      id: `pc-tcg-${price}-${out.length}`,
      title: String(title).slice(0, 160),
      price,
      currency: 'USD',
      source: 'tcgplayer',
      priceType: 'market',
      priceVerified: true,
      linkExact: /pricecharting\.com\/game\//i.test(pcUrl || ''),
      urlTrusted: /pricecharting\.com\/game\//i.test(pcUrl || ''),
      url: pcUrl,
      query,
      note: 'TCGPlayer Market Price vía PriceCharting (leído de la página)'
    });
  }
  return out;
}

function pickNearbyTitle(slice, query) {
  const lines = String(slice || '')
    .replace(/<[^>]+>/g, '\n')
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 8 && l.length <= 160);
  const qBits = String(query || '').toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 3);
  let best = '';
  let bestScore = -1;
  for (const line of lines) {
    if (/market\s*price|add to cart|sign in|cookie|filter|results|tcgplayer\s*\$/i.test(line)) continue;
    let score = 0;
    const up = line.toUpperCase();
    for (const b of qBits) {
      if (up.includes(b)) score += 3;
    }
    if (/EXR-|OP\d|ST\d|UA\d|#\d{2,}/i.test(line)) score += 4;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return best || '';
}

function mergeScraped(a, b) {
  const out = [...(a || [])];
  const key = (m) => `${Number(m.price).toFixed(2)}|${(m.productUrl || m.url || '').split('?')[0]}`;
  const seen = new Set(out.map(key));
  for (const m of b || []) {
    const k = key(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

function parseMoney(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchHtmlViaProxy(targetUrl, signal) {
  const proxies = [
    (u) => `https://r.jina.ai/http://${String(u).replace(/^https?:\/\//, '')}`,
    (u) => `https://r.jina.ai/https://${String(u).replace(/^https?:\/\//, '')}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`
  ];
  let lastErr = null;
  for (const build of proxies) {
    let t;
    try {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (signal) {
        if (signal.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
        signal.addEventListener('abort', onAbort, { once: true });
      }
      t = setTimeout(() => ctrl.abort(), 14000);
      const res = await fetch(build(targetUrl), {
        signal: ctrl.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain,*/*'
        }
      });
      clearTimeout(t);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.length < 120) throw new Error('Respuesta vacía');
      return text;
    } catch (err) {
      if (t) clearTimeout(t);
      if (err?.name === 'AbortError' && signal?.aborted) throw err;
      lastErr = err?.name === 'AbortError' ? new Error('timeout proxy TCG') : err;
    }
  }
  throw lastErr || new Error('No se pudo consultar TCGPlayer');
}
