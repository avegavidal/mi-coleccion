/**
 * Enlaces de mercado: foto primero, texto amplio (nunca título exacto largo).
 * Incluye TCGPlayer + Cardmarket para cartas.
 */

/** Señales claras de figura / prize / escala (nunca buscar como carta). */
const FIGURE_SIGNAL_RE = /\b(figure|figura|figuras|nendoroid|figma|figuarts|banpresto|ban.?dai\s*spirits|prize\s*figure|glitter\s*&\s*glamours|glitter\s+and\s+glamours|pop\s*up\s*parade|g\s*[x×]\s*materia|ichibansho|ichiban\s*kuji|scale\s*figure|\d+\/\d+\s*scale|statue|soft\s*vinyl|sofubi|garage\s*kit|resin\s*kit|model\s*kit|plamodel|gunpla)\b/i;

/** Categoría / tipo explícito de carta. */
const EXPLICIT_CARD_CATEGORY_RE = /\b(tcg|trading\s*cards?|cartas?\s*(tcg|coleccionables?)?|collectible\s*card|\bcarta\b)\b/i;

/** Juegos de cartas (requieren contexto de carta, no solo franchise de anime). */
const CARD_GAME_RE = /\b(pokemon|pokémon|yu-?gi-?oh|magic:?\s*the\s*gathering|\bmtg\b|one\s*piece\s*(card|tcg|optcg)|digimon\s*(card|tcg)|lorcana|flesh\s*and\s*blood|cardfight|vanguard|weiss\s*schwarz|battle\s*spirits|dragon\s*ball\s*(super\s*)?(card|fusion\s*world)|dbs\s*fw|union\s*arena|tcgplayer|cardmarket)\b/i;

/** Pistas de producto-carta (número de coleccionista, rareza, etc.). */
const CARD_PRODUCT_RE = /\b(trading\s*card|\bsingle\b|holo|reverse\s*holo|full\s*art|alt\s*art|secret\s*rare|ultra\s*rare|illustration\s*rare|\bir\b|sar|near\s*mint|\bnm\b|psa\s*\d|cgc\s*\d|\d{1,3}\s*\/\s*\d{2,3})\b/i;

/**
 * Detecta si la pieza parece una carta TCG (no una figura del mismo franchise).
 * Figuras Banpresto / Glitter & Glamours / Nendoroid etc. NO son cartas aunque sean de Pokémon o Bleach.
 * @param {object|string|null|undefined} itemOrText
 */
export function isTcgCardItem(itemOrText) {
  const text = typeof itemOrText === 'string'
    ? itemOrText
    : [
      itemOrText?.category,
      itemOrText?.series,
      itemOrText?.franchise,
      itemOrText?.name,
      itemOrText?.manufacturer,
      itemOrText?.collections?.name,
      itemOrText?.note
    ].filter(Boolean).join(' ');
  const blob = String(text || '').trim();
  if (!blob) return false;

  // Caja / línea de figura gana siempre (evita Bleach/Pokémon prize → TCGPlayer)
  if (FIGURE_SIGNAL_RE.test(blob)) return false;

  const category = typeof itemOrText === 'object' && itemOrText
    ? String(itemOrText.category || '')
    : '';
  if (/\b(tcg|trading\s*cards?|cartas?|collectible\s*card)\b/i.test(category)) {
    return true;
  }

  if (/\b(trading\s*cards?|tcg\b|cartas?\s*tcg)\b/i.test(blob)) return true;
  if (CARD_PRODUCT_RE.test(blob) && CARD_GAME_RE.test(blob)) return true;
  // Solo juego de cartas + palabra card/carta (no franchise solo)
  if (CARD_GAME_RE.test(blob) && /\b(cards?|cartas?|single|holo)\b/i.test(blob)) return true;
  // Categoría/series explícitas tipo Weiss Schwarz sin figura
  if (/\b(weiss\s*schwarz|cardfight\s*vanguard|union\s*arena|flesh\s*and\s*blood)\b/i.test(blob)) {
    return true;
  }
  return false;
}

/**
 * @param {string|null|undefined} imageUrl
 */
export function buildVisualMarketLinks(imageUrl) {
  const image = imageUrl ? String(imageUrl).trim() : '';
  if (!image) return [];
  const imgEnc = encodeURIComponent(image);
  return [
    {
      id: 'google-lens',
      region: 'VIS',
      label: 'Buscar precio por foto',
      kind: 'visual',
      primary: true,
      url: `https://lens.google.com/uploadbyurl?url=${imgEnc}`,
      hint: 'Google Lens identifica la figura/carta y muestra anuncios parecidos.'
    },
    {
      id: 'bing-visual',
      region: 'VIS',
      label: 'Bing Visual (foto)',
      kind: 'visual',
      primary: true,
      url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:${imgEnc}`,
      hint: 'Alternativa si Lens no abre bien en Safari.'
    }
  ];
}

/**
 * Enlaces TCG (cartas).
 * @param {string} query
 */
export function buildTcgShopLinks(query) {
  const q = (query || '').trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  return [
    {
      id: 'tcgplayer',
      region: 'US',
      label: 'TCGPlayer',
      kind: 'tcg',
      url: `https://www.tcgplayer.com/search/all/product?q=${enc}&view=grid`,
      hint: q
    },
    {
      id: 'cardmarket',
      region: 'US',
      label: 'Cardmarket',
      kind: 'tcg',
      url: `https://www.cardmarket.com/en/Products/Search?searchString=${enc}`,
      hint: q
    },
    {
      id: 'pricecharting',
      region: 'US',
      label: 'PriceCharting',
      kind: 'tcg',
      url: `https://www.pricecharting.com/search-products?q=${enc}&type=priced`,
      hint: q
    }
  ];
}

/**
 * Unas pocas tiendas con una consulta AMPLIA (2–5 palabras).
 * @param {string} query
 * @param {{ tcg?: boolean }} [opts]
 */
export function buildShopLinksForQuery(query, opts = {}) {
  const q = (query || '').trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const encPlus = encodeURIComponent(q).replace(/%20/g, '+');
  const yahooQ = encodeURIComponent(q);
  const tcgFirst = Boolean(opts.tcg);

  const figureShops = [
    {
      id: 'ebay-sold',
      region: 'US',
      label: 'eBay vendidos',
      kind: 'sold',
      url: `https://www.ebay.com/sch/i.html?_nkw=${enc}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`,
      hint: q
    },
    {
      id: 'amazon-us',
      region: 'US',
      label: 'Amazon US',
      kind: 'retail',
      url: `https://www.amazon.com/s?k=${enc}`,
      hint: q
    },
    {
      id: 'amazon-jp',
      region: 'JP',
      label: 'Amazon JP',
      kind: 'retail',
      url: `https://www.amazon.co.jp/s?k=${enc}`,
      hint: q
    },
    {
      id: 'ebay-active',
      region: 'US',
      label: 'eBay en venta',
      kind: 'asking',
      url: `https://www.ebay.com/sch/i.html?_nkw=${enc}&_sop=15&LH_BIN=1&_ipg=60`,
      hint: q
    },
    {
      id: 'mercari-us',
      region: 'US',
      label: 'Mercari US',
      kind: 'asking',
      url: `https://www.mercari.com/search/?keyword=${enc}`,
      hint: q
    },
    {
      id: 'yahoo-jp',
      region: 'JP',
      label: 'Yahoo Auctions JP',
      kind: 'auction',
      url: `https://auctions.yahoo.co.jp/search/search?va=${yahooQ}&fixed=0&exflg=1&b=1`,
      hint: q
    },
    {
      id: 'mercari-jp',
      region: 'JP',
      label: 'Mercari JP',
      kind: 'asking',
      url: `https://jp.mercari.com/search?keyword=${enc}`,
      hint: q
    },
    {
      id: 'amiami',
      region: 'JP',
      label: 'AmiAmi',
      kind: 'retail',
      url: `https://www.amiami.com/eng/search/list/?s_keywords=${encPlus}`,
      hint: q
    },
    {
      id: 'mandarake',
      region: 'JP',
      label: 'Mandarake',
      kind: 'used-shop',
      url: `https://order.mandarake.co.jp/order/listPage/list?keyword=${enc}&lang=en`,
      hint: q
    }
  ];

  const tcg = buildTcgShopLinks(q);
  // Cartas: TCGPlayer + Cardmarket primero; figuras: tiendas normales + TCG al final (por si acaso)
  return tcgFirst ? [...tcg, ...figureShops] : [...figureShops, ...tcg];
}

/**
 * @param {string} query
 * @param {{ imageUrl?: string|null, tcg?: boolean, item?: object }} [opts]
 */
export function buildMarketLinks(query, opts = {}) {
  const tcg = opts.tcg != null ? opts.tcg : isTcgCardItem(opts.item || query);
  return [
    ...buildVisualMarketLinks(opts.imageUrl),
    ...buildShopLinksForQuery(query, { tcg })
  ];
}

/**
 * @param {string} query
 */
export function ebayMarketUrls(query) {
  const links = buildShopLinksForQuery(query);
  return {
    sold: links.find((l) => l.id === 'ebay-sold')?.url || '',
    active: links.find((l) => l.id === 'ebay-active')?.url || ''
  };
}

/**
 * @param {object} item
 */
export function buildEbayQuery(item) {
  if (!item) return '';
  return [item.manufacturer, item.item_number, item.franchise, item.character_name]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
    .join(' ');
}

const STORE_LINK_IDS = {
  ebay: 'ebay-active',
  'ebay-sold': 'ebay-sold',
  'ebay-active': 'ebay-active',
  amazon: 'amazon-us',
  'amazon-us': 'amazon-us',
  'amazon.com': 'amazon-us',
  'amazon-jp': 'amazon-jp',
  'amazon.co.jp': 'amazon-jp',
  mercari: 'mercari-us',
  'mercari-us': 'mercari-us',
  'mercari-jp': 'mercari-jp',
  yahoo: 'yahoo-jp',
  'yahoo-jp': 'yahoo-jp',
  amiami: 'amiami',
  mandarake: 'mandarake',
  tcgplayer: 'tcgplayer',
  cardmarket: 'cardmarket',
  pricecharting: 'pricecharting'
};

/**
 * Nombre corto de la tienda para el botón.
 * @param {string} source
 */
export function storeLabel(source) {
  const s = String(source || '').toLowerCase();
  if (s.includes('tcgplayer')) return 'TCGPlayer';
  if (s.includes('cardmarket')) return 'Cardmarket';
  if (s.includes('pricechart')) return 'PriceCharting';
  if (s.includes('amazon') && (s.includes('jp') || s.includes('.co.jp'))) return 'Amazon JP';
  if (s.includes('amazon')) return 'Amazon';
  if (s.includes('mercari') && s.includes('jp')) return 'Mercari JP';
  if (s.includes('mercari')) return 'Mercari';
  if (s.includes('yahoo')) return 'Yahoo JP';
  if (s.includes('amiami')) return 'AmiAmi';
  if (s.includes('mandarake')) return 'Mandarake';
  if (s.includes('ebay')) return 'eBay';
  return 'tienda';
}

/**
 * Limpia título/query para armar una búsqueda usable (quita “eBay típico:”, buy, etc.).
 * @param {{ title?: string, query?: string, source?: string }} match
 */
export function cleanMarketSearchQuery(match) {
  let t = String(match?.query || match?.title || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.replace(
    /^(eBay|Amazon|Mercari|AmiAmi|Yahoo|TCGPlayer|Cardmarket|PriceCharting|Mandarake)\s*(activo|vendidos?|bajo|típico|alto|sold|active|low|mid|high)?\s*:\s*/i,
    ''
  );
  t = t.replace(/\s+\b(buy|for sale|en venta)\b\s*$/i, '').trim();
  // Si quedó basura muy corta, intentar el otro campo
  if (t.length < 4 && match?.title && match?.query) {
    const alt = String(match.title !== match.query ? (match.title || match.query) : match.query)
      .replace(/\s+/g, ' ')
      .trim();
    if (alt.length > t.length) t = alt;
  }
  return t.slice(0, 140);
}

/**
 * Normaliza / desenreda URLs de Gemini o grounding de Google.
 * Descarta redirects de Vertex que no abren bien en Safari.
 * @param {string} url
 * @returns {string}
 */
export function normalizeMarketUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  // markdown accidental
  u = u.replace(/^<|>$/g, '').replace(/^\[.*?\]\((.*)\)$/, '$1').trim();

  if (!/^https?:\/\//i.test(u) && /^[\w.-]+\.[a-z]{2,}([/:?]|$)/i.test(u)) {
    u = `https://${u}`;
  }
  if (!/^https?:\/\//i.test(u)) return '';

  // Redirects de grounding de Gemini: no abren bien / caducan
  if (/vertexaisearch\.cloud\.google\.com|grounding-api-redirect|googleusercontent\.com\/grounding/i.test(u)) {
    return '';
  }

  try {
    const parsed = new URL(u);
    // google.com/url?url=https://ebay...
    if (/google\./i.test(parsed.hostname) && (parsed.searchParams.has('url') || parsed.searchParams.has('q'))) {
      const inner = parsed.searchParams.get('url') || parsed.searchParams.get('q') || '';
      if (/^https?:\/\//i.test(inner) && !/google\./i.test(inner)) {
        return normalizeMarketUrl(inner);
      }
    }
    // limpia tracking inútil pero conserva path
    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * ¿Es URL de un anuncio/producto concreto (no página de búsqueda)?
 * @param {string} url
 */
export function isDirectListingUrl(url) {
  const u = normalizeMarketUrl(url) || String(url || '');
  if (!/^https?:\/\//i.test(u)) return false;
  if (/vertexaisearch|grounding-api-redirect/i.test(u)) return false;
  if (/\/sch\/i\.html|\/s\?k=|\/search\/|\?q=|searchString=|search-products|keyword=/i.test(u)
    && !/\/itm\/|\/dp\/|\/item\/|\/product\//i.test(u)) {
    return false;
  }
  return (
    /ebay\.[^/]+\/itm\//i.test(u)
    || /amazon\.[^/]+\/(dp|gp\/product)\//i.test(u)
    || /mercari\.com\/(?:us\/)?item\//i.test(u)
    || /jp\.mercari\.com\/item\//i.test(u)
    || /amiami\.com\/.+\/detail\./i.test(u)
    || /amiami\.com\/.+\/detail\//i.test(u)
    || /tcgplayer\.com\/product\//i.test(u)
    || /page\.auctions\.yahoo\.co\.jp\/jp\/auction\//i.test(u)
    || /mandarake\.co\.jp\/.+/i.test(u) && /detail|item/i.test(u)
    || /pricecharting\.com\/game\//i.test(u)
    || /cardmarket\.com\/.+\/Products\/.+\/.+/i.test(u)
  );
}

/**
 * Anuncio con ID creíble. Gemini inventa /itm/ cortos → eBay "Not Found".
 * @param {string} url
 */
export function isPlausibleListingUrl(url) {
  const u = normalizeMarketUrl(url);
  if (!u || !isDirectListingUrl(u)) return false;
  if (/ebay\./i.test(u)) return /ebay\.[^/]+\/itm\/\d{9,14}(?:\b|\/|\?|#|$)/i.test(u);
  if (/amazon\./i.test(u)) return /amazon\.[^/]+\/(?:dp|gp\/product)\/[A-Z0-9]{10}\b/i.test(u);
  if (/mercari\./i.test(u)) return /\/item\/[a-z0-9]{6,}/i.test(u);
  if (/tcgplayer\.com\/product\/\d{4,}/i.test(u)) return true;
  if (/amiami\.com\/.+\/detail/i.test(u)) return true;
  if (/yahoo\.co\.jp\/jp\/auction\/[a-z0-9]+/i.test(u)) return true;
  return true;
}

/**
 * ¿Se puede abrir en navegador como tienda/búsqueda conocida?
 * @param {string} url
 */
export function isOpenableStoreUrl(url) {
  const u = normalizeMarketUrl(url);
  if (!u) return false;
  if (isDirectListingUrl(u)) return true;
  return (
    /ebay\.[^/]+\/sch\//i.test(u)
    || /amazon\.[^/]+\/s\?/i.test(u)
    || /mercari\./i.test(u)
    || /amiami\.com/i.test(u)
    || /yahoo\.co\.jp|auctions\.yahoo/i.test(u)
    || /tcgplayer\.com/i.test(u)
    || /cardmarket\.com/i.test(u)
    || /pricecharting\.com/i.test(u)
    || /mandarake\.co\.jp/i.test(u)
  );
}

/**
 * Tokens de identidad de la pieza (foto / ficha) para filtrar matches ajenos.
 * @param {object|null|undefined} item
 * @returns {string[]}
 */
export function identityTokens(item) {
  if (!item) return [];
  const raw = [
    item.character_name || item.character,
    item.series,
    item.manufacturer,
    item.item_number,
    item.franchise,
    ...(String(item.name || '').split(/[\s:/|]+/))
  ];
  const stop = /^(the|and|for|with|figure|figura|prize|scale|banpresto|bandai|spirits|good|smile|company|ver|version|edition|special|color|a|b|buy|sale)$/i;
  const out = [];
  const seen = new Set();
  for (const part of raw) {
    for (const t of String(part || '').toLowerCase().split(/[\s&×x +_/,-]+/)) {
      const tok = t.replace(/[^a-z0-9áéíóúñ]/gi, '');
      if (tok.length < 3 || stop.test(tok) || seen.has(tok)) continue;
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

/**
 * ¿El anuncio/título corresponde a la pieza de la foto (no otra figura de la misma línea)?
 * @param {{ title?: string, query?: string, note?: string }} match
 * @param {object|null|undefined} item
 */
export function matchBelongsToItem(match, item) {
  if (!item) return true;
  const title = `${match?.title || ''} ${match?.note || ''}`.toLowerCase();
  if (!title.trim()) return false;

  const character = String(item.character_name || item.character || '').toLowerCase().trim();
  const series = String(item.series || '').toLowerCase().trim();
  const name = String(item.name || '').toLowerCase().trim();

  // Personaje: si lo conocemos, el título debe incluir al menos un token fuerte
  if (character.length >= 3) {
    const parts = character.split(/\s+/).map((p) => p.replace(/[^a-z0-9áéíóúñ]/gi, '')).filter((p) => p.length >= 3);
    const charHit = parts.some((p) => title.includes(p)) || title.includes(character);
    if (!charHit) return false;
  }

  // Serie / línea (Glitter, Nendoroid, Gxmateria…): al menos un token si hay personaje+serie
  if (series.length >= 4 && character.length >= 3) {
    const seriesParts = series.split(/[\s&×x]+/).map((p) => p.replace(/[^a-z0-9]/gi, '')).filter((p) => p.length >= 4);
    if (seriesParts.length && !seriesParts.some((p) => title.includes(p))) {
      // Permitir si el nombre oficial completo aparece
      if (!(name.length >= 10 && name.split(/\s+/).filter((t) => t.length > 3).slice(0, 3).every((t) => title.includes(t)))) {
        return false;
      }
    }
  }

  const tokens = identityTokens(item);
  if (tokens.length >= 3) {
    const hits = tokens.filter((t) => title.includes(t)).length;
    // Exige ~40% de tokens de identidad (mín. 2)
    if (hits < Math.max(2, Math.ceil(tokens.length * 0.35))) return false;
  }
  return true;
}

/**
 * Query de búsqueda anclada a la pieza identificada (foto), no a un título ajeno.
 * @param {object|null|undefined} item
 * @param {{ title?: string, query?: string }} [match]
 */
export function preferredSearchQuery(item, match = null) {
  const fromItem = [
    item?.name,
    [item?.series, item?.character_name || item?.character].filter(Boolean).join(' '),
    [item?.manufacturer, item?.character_name || item?.character].filter(Boolean).join(' '),
    [item?.franchise, item?.character_name || item?.character].filter(Boolean).join(' ')
  ]
    .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 5);

  const matchQ = cleanMarketSearchQuery(match || {});
  if (matchQ && matchBelongsToItem({ title: matchQ }, item)) {
    // Preferir nombre oficial de la ficha/foto si es sólido
    if (item?.name && String(item.name).trim().length >= 10) return String(item.name).trim().slice(0, 140);
    return matchQ;
  }
  return (fromItem[0] || matchQ || '').slice(0, 140);
}

/**
 * URL + si es anuncio exacto o solo búsqueda orientativa.
 * Si el anuncio no es de ESTA pieza, arma búsqueda de la pieza de la foto.
 * @param {{ source?: string, title?: string, url?: string, query?: string, price?: number, category?: string, series?: string }} match
 * @param {object|null} [item] pieza identificada (foto / ficha)
 * @returns {{ url: string, exact: boolean, label: string }}
 */
export function listingLinkMeta(match, item = null) {
  const source = storeLabel(match?.source);
  const raw = normalizeMarketUrl(match?.url);
  const belongs = matchBelongsToItem(match, item);
  // Solo abrir /itm/ si lo scrapamos nosotros (urlTrusted). Los de Gemini suelen 404.
  const trustedExact = match?.urlTrusted === true
    && isPlausibleListingUrl(raw)
    && belongs;

  if (trustedExact) {
    return {
      url: raw,
      exact: true,
      label: `Abrir anuncio en ${source} →`
    };
  }

  const searchQ = preferredSearchQuery(item, match);
  const url = storeLinkForMatch({
    ...match,
    title: searchQ,
    query: searchQ,
    url: '',
    urlTrusted: false
  }, item);
  return {
    url,
    exact: false,
    label: url ? `Buscar esta pieza en ${source} →` : 'Sin enlace válido'
  };
}

/**
 * URL para abrir el producto en su tienda.
 * Anuncio directo solo si urlTrusted; si no, búsqueda del título (± rango de precio).
 * @param {{ source?: string, title?: string, url?: string, query?: string, price?: number, category?: string, series?: string, urlTrusted?: boolean }} match
 * @param {object|null} [item]
 */
export function storeLinkForMatch(match, item = null) {
  const direct = normalizeMarketUrl(match?.url);
  if (match?.urlTrusted && isPlausibleListingUrl(direct) && matchBelongsToItem(match, item)) {
    return direct;
  }

  const title = preferredSearchQuery(item, match) || cleanMarketSearchQuery(match);
  if (!title) {
    return isOpenableStoreUrl(direct) && !isDirectListingUrl(direct) ? direct : '';
  }
  const s = String(match?.source || '').toLowerCase().replace(/\s+/g, '');
  const tcg = isTcgCardItem({
    source: match?.source,
    name: title,
    title,
    category: match?.category || item?.category,
    series: match?.series || item?.series
  }) || /^(tcgplayer|cardmarket|pricecharting)$/i.test(s);
  const price = Number(match?.price);
  const links = buildShopLinksForQuery(title, { tcg });
  let id = STORE_LINK_IDS[s] || '';
  if (!id) {
    if (s.includes('tcgplayer')) id = 'tcgplayer';
    else if (s.includes('cardmarket')) id = 'cardmarket';
    else if (s.includes('pricechart')) id = 'pricecharting';
    else if (s.includes('amazon') && s.includes('jp')) id = 'amazon-jp';
    else if (s.includes('amazon')) id = 'amazon-us';
    else if (s.includes('mercari') && s.includes('jp')) id = 'mercari-jp';
    else if (s.includes('mercari')) id = 'mercari-us';
    else if (s.includes('yahoo')) id = 'yahoo-jp';
    else if (s.includes('amiami')) id = 'amiami';
    else if (s.includes('mandarake')) id = 'mandarake';
    else if (s.includes('ebay')) id = 'ebay-active';
    else id = tcg ? 'tcgplayer' : 'ebay-active';
  }
  let url = links.find((l) => l.id === id)?.url || links[0]?.url || '';
  if (url && Number.isFinite(price) && price > 0) {
    url = withPriceBand(url, id, price);
  }
  if (url) return url;
  return isOpenableStoreUrl(direct) && !isDirectListingUrl(direct) ? direct : '';
}

/**
 * Acota la búsqueda al rango del precio mostrado (±15%).
 * @param {string} url
 * @param {string} shopId
 * @param {number} priceUsd
 */
export function withPriceBand(url, shopId, priceUsd) {
  const p = Number(priceUsd);
  if (!url || !Number.isFinite(p) || p <= 0) return url;
  const lo = Math.max(1, Math.floor(p * 0.85));
  const hi = Math.ceil(p * 1.15);
  try {
    const u = new URL(url);
    if (shopId === 'ebay-active' || shopId === 'ebay-sold' || /ebay\.com\/sch/i.test(url)) {
      u.searchParams.set('_udlo', String(lo));
      u.searchParams.set('_udhi', String(hi));
      return u.toString();
    }
    if (shopId === 'amazon-us' || /amazon\.com\/s\?/i.test(url)) {
      // Amazon US: precio en centavos
      const rh = `p_36:${lo * 100}-${hi * 100}`;
      const prev = u.searchParams.get('rh');
      u.searchParams.set('rh', prev ? `${prev},${rh}` : rh);
      return u.toString();
    }
  } catch {
    // keep original
  }
  return url;
}
