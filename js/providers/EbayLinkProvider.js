/**
 * Enlaces de mercado: foto primero, texto amplio (nunca título exacto largo).
 * Incluye TCGPlayer + Cardmarket para cartas.
 */

/**
 * Detecta si la pieza parece una carta TCG.
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
      itemOrText?.collections?.name
    ].filter(Boolean).join(' ');
  return /tcg|trading\s*card|carta|cards?|pokemon|pokémon|yu-?gi-?oh|magic:?\s*the\s*gathering|\bmtg\b|one\s*piece\s*card|digimon\s*card|lorcana|flesh\s*and\s*blood|\bfab\b|cardfight|vanguard|weiss|schwarz|battle\s*spirits|dragon\s*ball\s*(super\s*)?card|dbs\s*fw|union\s*arena/i.test(String(text || ''));
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
 * URL para abrir el producto en su tienda.
 * Si ya hay un enlace http real, se usa; si no, búsqueda de ESE título en esa tienda.
 * @param {{ source?: string, title?: string, url?: string, query?: string }} match
 */
export function storeLinkForMatch(match) {
  const direct = typeof match?.url === 'string' && /^https?:\/\//i.test(match.url.trim())
    ? match.url.trim()
    : '';
  if (direct && !/example\.com|google\.com\/search\?/i.test(direct)) return direct;

  const title = String(match?.title || match?.query || '').trim().slice(0, 140);
  if (!title) return direct;
  const s = String(match?.source || '').toLowerCase().replace(/\s+/g, '');
  const tcg = /tcg|cardmarket|pricechart|pokemon|yugioh|mtg/.test(s + title);
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
  return links.find((l) => l.id === id)?.url || direct || links[0]?.url || '';
}
