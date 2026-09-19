/**
 * Enlaces de mercado: foto primero, texto amplio (nunca título exacto largo).
 */

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
      hint: 'Google Lens identifica la figura y muestra anuncios parecidos (eBay, Amazon, shops).'
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
 * Unas pocas tiendas con una consulta AMPLIA (2–5 palabras).
 * @param {string} query
 */
export function buildShopLinksForQuery(query) {
  const q = (query || '').trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const encPlus = encodeURIComponent(q).replace(/%20/g, '+');
  const yahooQ = encodeURIComponent(q);

  return [
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
}

/**
 * @param {string} query
 * @param {{ imageUrl?: string|null }} [opts]
 */
export function buildMarketLinks(query, opts = {}) {
  return [
    ...buildVisualMarketLinks(opts.imageUrl),
    ...buildShopLinksForQuery(query)
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
