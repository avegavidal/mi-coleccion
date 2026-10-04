/**
 * Mercari JP (jp.mercari.com) + Mercari US (www.mercari.com): precios de segunda mano.
 * - Texto: scrape de búsqueda por keyword (proxy).
 * - Foto: la búsqueda visual nativa de Mercari no acepta URL remota;
 *   AutoMarketSearchProvider adjunta la misma foto a Gemini + Google Search
 *   y pide anuncios reales de jp.mercari.com/item/…
 */
import { storeLinkForMatch } from './EbayLinkProvider.js';

const JPY_TO_USD = 0.0067; // aproximado; el note guarda el yen original

/**
 * Mercari US: scrape de búsqueda ($USD en anuncios /us/item/…).
 * @param {string} query
 * @param {{ limit?: number, signal?: AbortSignal }} [opts]
 */
export async function lookupMercariUsMarket(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Falta consulta para Mercari US');

  const limit = opts.limit ?? 8;
  const searchUrl = `https://www.mercari.com/search/?keyword=${encodeURIComponent(q)}`;
  /** @type {object[]} */
  let matches = [];
  const errors = [];

  try {
    // jina https es el más fiable para Mercari US; el pool de proxies a veces cuela homepage
    let html = await fetchJinaHttps(searchUrl, opts.signal).catch(() => null);
    if (!html) html = await fetchHtmlViaProxy(searchUrl, opts.signal);
    matches = extractMercariUsMatches(html, q, { searchUrl });
    const relevance = matches.filter((m) => queryTitleScore(m.title, q) >= 2).length;
    if (relevance < 1) {
      const direct = await fetchJinaHttps(searchUrl, opts.signal).catch(() => null);
      if (direct) {
        const again = extractMercariUsMatches(direct, q, { searchUrl });
        if (again.filter((m) => queryTitleScore(m.title, q) >= 2).length > relevance) {
          matches = again;
        }
      }
    }
  } catch (err) {
    errors.push(`Mercari US: ${err.message || err}`);
  }

  const ranked = matches
    .filter((m) => Number(m.price) > 0)
    .map((m) => ({ ...m, _qScore: queryTitleScore(m.title, q) }))
    .sort((a, b) => b._qScore - a._qScore || a.price - b.price);
  const bestScore = ranked[0]?._qScore ?? 0;
  const list = ranked
    .filter((m) => bestScore < 2 || m._qScore >= Math.max(1, bestScore - 2))
    .slice(0, limit)
    .map(({ _qScore, ...m }) => m);

  return {
    matches: list,
    searchUrl,
    note: list.length
      ? `Mercari US: ${list.length} anuncio${list.length === 1 ? '' : 's'} leído${list.length === 1 ? '' : 's'}.`
      : (errors[0] || 'Sin anuncios en Mercari US.'),
    errors
  };
}

/**
 * @param {string} html
 * @param {string} [query]
 * @param {{ searchUrl?: string }} [ctx]
 */
export function extractMercariUsMatches(html, query = '', ctx = {}) {
  if (!html) return [];
  const text = String(html);
  const q = String(query || '').trim();
  /** @type {object[]} */
  const out = [];
  const seen = new Set();

  // jina markdown:
  // [![alt](https://u-mercari-images.../mID_1.jpg) Title $149.99](https://www.mercari.com/us/item/mID)
  const mdRe = /\]\((https?:\/\/[^)\s]*mercdn\.net[^)\s]*)\)\s*([^$\n\]]{5,160}?)\s+\$([\d,]+(?:\.\d{1,2})?)\s*\]\(\s*(https?:\/\/(?:www\.)?mercari\.com\/(?:us\/)?item\/(m?[a-z0-9]{6,})[^)\s]*)/gi;
  let m;
  while ((m = mdRe.exec(text)) !== null) {
    const title = String(m[2] || '').replace(/^[#*\-\s]+/, '').replace(/\s+/g, ' ').trim();
    const price = Number(String(m[3]).replace(/,/g, ''));
    const id = m[5];
    pushUsMatch(out, seen, { id, title, price, q });
  }

  // Sin imagen embebida: "Title $70.00](https://www.mercari.com/us/item/m…)"
  if (!out.length) {
    const plainRe = /(?:^|[^\]])([^\[\]\n]{8,160}?)\s+\$([\d,]+(?:\.\d{1,2})?)\s*\]\(\s*(https?:\/\/(?:www\.)?mercari\.com\/(?:us\/)?item\/(m?[a-z0-9]{6,})[^)\s]*)/gi;
    let pm;
    while ((pm = plainRe.exec(text)) !== null) {
      const title = String(pm[1] || '').replace(/^[#*\-\s.(]+/, '').replace(/\s+/g, ' ').trim();
      if (/^https?:/i.test(title) || /mercdn\.net/i.test(title)) continue;
      const price = Number(String(pm[2]).replace(/,/g, ''));
      pushUsMatch(out, seen, { id: pm[4], title, price, q });
    }
  }

  // Fallback: $precio pegado al /item/m…
  if (!out.length) {
    const looseRe = /\$\s*([\d,]+(?:\.\d{1,2})?)\s*\]\(\s*https?:\/\/(?:www\.)?mercari\.com\/(?:us\/)?item\/(m?[a-z0-9]{6,})/gi;
    let lm;
    while ((lm = looseRe.exec(text)) !== null) {
      const price = Number(String(lm[1]).replace(/,/g, ''));
      const id = lm[2];
      const window = text.slice(Math.max(0, lm.index - 160), lm.index);
      const titleGuess = window.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(-120);
      pushUsMatch(out, seen, { id, title: titleGuess, price, q });
    }
  }

  return out
    .map((row) => {
      if (row.url) return row;
      const link = storeLinkForMatch({ ...row, source: 'mercari' }, { name: q });
      return { ...row, url: link?.url || ctx.searchUrl || '' };
    })
    .sort((a, b) => queryTitleScore(b.title, q) - queryTitleScore(a.title, q) || a.price - b.price);
}

function queryTitleScore(title, query) {
  const t = String(title || '').toLowerCase();
  const qTokens = String(query || '').toLowerCase().split(/\s+/).filter((x) => x.length > 2);
  let score = 0;
  for (const tok of qTokens) {
    if (t.includes(tok)) score += 1;
    else if (tok.length >= 6 && t.includes(tok.slice(0, 6))) score += 0.5; // Ichibansho≈Ichiban
  }
  // Penalizar si parece otra franquicia dominante
  if (/jujutsu|demon\s*slayer|dragon\s*ball|one\s*piece|naruto/i.test(t)
    && !/hunter/i.test(t)) {
    score -= 3;
  }
  return score;
}

function pushUsMatch(out, seen, { id, title, price, q }) {
  if (!id || !(price > 0) || price > 50_000) return;
  const key = `${id}|${price}`;
  if (seen.has(key)) return;
  seen.add(key);
  const cleanTitle = String(title || '').trim();
  out.push({
    id: `mercari-us-${id}-${price}`,
    title: cleanTitle || (q ? `${q} (Mercari US)` : `Mercari US ${id}`),
    price,
    currency: 'USD',
    source: 'mercari',
    priceType: 'listing',
    priceVerified: true,
    linkExact: true,
    urlTrusted: true,
    url: `https://www.mercari.com/item/${id}`,
    query: q,
    note: `$${Number(price).toFixed(2)} en Mercari US`
  });
}

/**
 * @param {string} query
 * @param {{ limit?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ matches: object[], searchUrl: string, note: string, errors?: string[] }>}
 */
export async function lookupMercariJpMarket(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Falta consulta para Mercari JP');

  const limit = opts.limit ?? 8;
  const searchUrl = `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}&status=on_sale`;
  /** @type {object[]} */
  let matches = [];
  const errors = [];

  try {
    const html = await fetchHtmlViaProxy(searchUrl, opts.signal);
    matches = extractMercariJpMatches(html, q, { searchUrl });
  } catch (err) {
    errors.push(`Mercari JP: ${err.message || err}`);
  }

  // Si hay URLs de ítem, abrir 1–2 fichas para precio más limpio
  const itemUrls = [...new Set(
    matches.map((m) => m.url).filter((u) => /jp\.mercari\.com\/item\/[a-z0-9]+/i.test(u || ''))
  )].slice(0, 2);

  for (const itemUrl of itemUrls) {
    if (matches.some((m) => m.priceVerified && m.url === itemUrl)) continue;
    try {
      const page = await fetchHtmlViaProxy(itemUrl, opts.signal);
      const fromPage = extractMercariJpMatches(page, q, { searchUrl: itemUrl, itemUrl });
      matches = mergeScraped(matches, fromPage);
    } catch (err) {
      errors.push(`Ítem Mercari: ${err.message || err}`);
    }
  }

  const list = matches
    .filter((m) => Number(m.price) > 0)
    .sort((a, b) => (b.priceVerified ? 1 : 0) - (a.priceVerified ? 1 : 0) || a.price - b.price)
    .slice(0, limit);

  return {
    matches: list,
    searchUrl,
    note: list.length
      ? `Mercari JP: ${list.length} anuncio${list.length === 1 ? '' : 's'} leído${list.length === 1 ? '' : 's'}.`
      : (errors[0] || 'Sin anuncios en Mercari JP.'),
    errors
  };
}

/**
 * @param {string} html
 * @param {string} query
 * @param {{ searchUrl?: string, itemUrl?: string }} [ctx]
 */
export function extractMercariJpMatches(html, query = '', ctx = {}) {
  if (!html) return [];
  const text = String(html);
  const q = String(query || '').trim();
  /** @type {object[]} */
  const out = [];
  const seen = new Set();

  // URLs de ítem + yen cerca
  const itemRe = /https?:\/\/jp\.mercari\.com\/item\/(m?[a-z0-9]{6,})/gi;
  let m;
  const ids = [];
  while ((m = itemRe.exec(text)) !== null) {
    const id = m[1];
    if (!ids.includes(id)) ids.push(id);
  }

  for (const id of ids.slice(0, 12)) {
    const url = `https://jp.mercari.com/item/${id}`;
    const idx = text.indexOf(id);
    const window = text.slice(Math.max(0, idx - 280), idx + 480);
    const yen = parseYen(window) ?? parseYen(text.slice(idx, idx + 800));
    if (yen == null) continue;
    const usd = Math.round(yen * JPY_TO_USD * 100) / 100;
    const key = `${id}|${usd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = pickTitleNear(window, q) || `Mercari JP ${id}`;
    out.push({
      id: `mercari-jp-${id}-${yen}`,
      title,
      price: usd,
      currency: 'USD',
      source: 'mercari',
      priceType: 'listing',
      priceVerified: Boolean(ctx.itemUrl),
      linkExact: true,
      urlTrusted: true,
      url,
      query: q,
      note: `¥${yen.toLocaleString('ja-JP')} en Mercari JP${ctx.itemUrl ? ' (ficha)' : ''}`,
      originalYen: yen
    });
  }

  // Fallback markdown/jina: ¥1,980 … item/m…
  if (!out.length) {
    const lineRe = /¥\s*([\d,]+)\s*[^\n]{0,120}?mercari\.com\/item\/(m?[a-z0-9]{6,})/gi;
    let lm;
    while ((lm = lineRe.exec(text)) !== null) {
      const yen = parseYen(lm[1]);
      if (yen == null) continue;
      const id = lm[2];
      const usd = Math.round(yen * JPY_TO_USD * 100) / 100;
      const key = `${id}|${usd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const url = `https://jp.mercari.com/item/${id}`;
      out.push({
        id: `mercari-jp-md-${id}-${yen}`,
        title: q ? `${q} (Mercari JP)` : `Mercari JP ${id}`,
        price: usd,
        currency: 'USD',
        source: 'mercari',
        priceType: 'listing',
        priceVerified: false,
        linkExact: true,
        urlTrusted: true,
        url,
        query: q,
        note: `¥${yen.toLocaleString('ja-JP')} Mercari JP`,
        originalYen: yen
      });
    }
  }

  // Si la página es una ficha única con precio
  if (ctx.itemUrl && !out.length) {
    const yen = parseYen(text);
    if (yen != null) {
      const usd = Math.round(yen * JPY_TO_USD * 100) / 100;
      out.push({
        id: `mercari-jp-page-${yen}`,
        title: pickTitleNear(text.slice(0, 500), q) || q || 'Mercari JP',
        price: usd,
        currency: 'USD',
        source: 'mercari',
        priceType: 'listing',
        priceVerified: true,
        linkExact: true,
        urlTrusted: true,
        url: ctx.itemUrl,
        query: q,
        note: `¥${yen.toLocaleString('ja-JP')} (ficha Mercari JP)`,
        originalYen: yen
      });
    }
  }

  // Enriquecer con storeLinkForMatch por si falta url
  return out.map((row) => {
    if (row.url) return row;
    const link = storeLinkForMatch({ ...row, source: 'mercari' }, { name: q });
    return { ...row, url: link?.url || ctx.searchUrl || '' };
  });
}

function parseYen(raw) {
  if (raw == null) return null;
  const s = String(raw);
  const m = s.match(/¥\s*([\d,]+)/) || s.match(/([\d,]+)\s*円/) || s.match(/^([\d,]+)$/);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 100 && n < 10_000_000 ? n : null;
}

function pickTitleNear(window, query) {
  const lines = String(window || '')
    .split(/\n+/)
    .map((l) => l.replace(/[#*_`\[\]]/g, '').trim())
    .filter((l) => l.length >= 8 && l.length < 160 && !/^https?:/i.test(l));
  if (!lines.length) return '';
  const qTokens = String(query || '').toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  let best = lines[0];
  let bestScore = -1;
  for (const line of lines.slice(0, 20)) {
    let score = 0;
    const low = line.toLowerCase();
    for (const t of qTokens) if (low.includes(t)) score += 2;
    if (/nendoroid|banpresto|bandai|figure|フィギュア/i.test(line)) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return best;
}

function mergeScraped(a, b) {
  const out = [...(a || [])];
  const key = (m) => `${(m.url || '').split('?')[0]}|${Number(m.price).toFixed(2)}`;
  const seen = new Set(out.map(key));
  for (const m of b || []) {
    const k = key(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

async function fetchJinaHttps(targetUrl, signal) {
  const url = `https://r.jina.ai/https://${String(targetUrl).replace(/^https?:\/\//, '')}`;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
    signal.addEventListener('abort', onAbort, { once: true });
  }
  const t = setTimeout(() => ctrl.abort(), 18000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; MiColeccion/1.0)'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!isUsefulMercariBody(text)) throw new Error('jina sin anuncios');
    return text;
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** ¿El HTML/markdown trae anuncios útiles (no stub de cookies)? */
function isUsefulMercariBody(text) {
  const s = String(text || '');
  if (s.length < 200) return false;
  if (/mercari\.com\/(?:us\/)?item\//i.test(s) || /jp\.mercari\.com\/item\//i.test(s)) return true;
  if (/\$\s*[\d,]+(?:\.\d{1,2})?/.test(s) && /item\/m?/i.test(s)) return true;
  if (/¥\s*[\d,]+/.test(s) || /\d{3,7}\s*円/.test(s)) return true;
  // Consent / privacy stub (jina http a veces devuelve esto con 200)
  if (/privacy settings|consent\.trustarc|we use cookies/i.test(s) && s.length < 4000) return false;
  return false;
}

async function fetchHtmlViaProxy(targetUrl, signal) {
  // https primero: el modo http de jina a menudo devuelve stub de cookies (200 vacío)
  const proxies = [
    (u) => `https://r.jina.ai/https://${String(u).replace(/^https?:\/\//, '')}`,
    (u) => `https://r.jina.ai/${u}`,
    (u) => `https://r.jina.ai/http://${String(u).replace(/^https?:\/\//, '')}`,
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
      t = setTimeout(() => ctrl.abort(), 18000);
      const res = await fetch(build(targetUrl), {
        signal: ctrl.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; MiColeccion/1.0; +local)'
        }
      });
      clearTimeout(t);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.length < 120) throw new Error('Respuesta vacía');
      if (!isUsefulMercariBody(text)) throw new Error('proxy sin anuncios (stub)');
      // Preferir páginas de búsqueda reales (evita homepage/trending si un proxy la cuela)
      if (/mercari\.com\/search/i.test(String(targetUrl)) && !/search result|results for|on_sale|keyword=/i.test(text)
        && !/\$\s*[\d,.]+/.test(text)) {
        throw new Error('proxy sin resultados de búsqueda');
      }
      return text;
    } catch (err) {
      if (t) clearTimeout(t);
      if (err?.name === 'AbortError' && signal?.aborted) throw err;
      lastErr = err?.name === 'AbortError' ? new Error('timeout proxy Mercari') : err;
    }
  }
  throw lastErr || new Error('No se pudo consultar Mercari');
}
