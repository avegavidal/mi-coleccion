/**
 * Enlaces de mercado US + Japón para figuras / coleccionables.
 * Sin scraping de sitios con login wall (eBay sold desde ago 2026).
 */

/**
 * @param {string} query
 * @returns {{ id: string, region: 'US'|'JP', label: string, kind: string, url: string, hint: string }[]}
 */
export function buildMarketLinks(query) {
  const q = (query || '').trim();
  const enc = encodeURIComponent(q);
  const encPlus = encodeURIComponent(q).replace(/%20/g, '+');
  const yahooQ = encodeURIComponent(q);

  return [
    {
      id: 'ebay-sold',
      region: 'US',
      label: 'eBay — vendidos',
      kind: 'sold',
      url: `https://www.ebay.com/sch/i.html?_nkw=${enc}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`,
      hint: 'Mejor referencia real (últimos ~90 días). Puede pedir login en Safari.'
    },
    {
      id: 'ebay-active',
      region: 'US',
      label: 'eBay — en venta',
      kind: 'asking',
      url: `https://www.ebay.com/sch/i.html?_nkw=${enc}&_sop=15&LH_BIN=1&_ipg=60`,
      hint: 'Precios pedidos (Buy It Now). Suele estar más alto que lo vendido.'
    },
    {
      id: 'mercari-us',
      region: 'US',
      label: 'Mercari US',
      kind: 'asking',
      url: `https://www.mercari.com/search/?keyword=${enc}`,
      hint: 'Mercado de segunda mano en EE.UU.'
    },
    {
      id: 'yahoo-jp',
      region: 'JP',
      label: 'Yahoo! Auctions JP',
      kind: 'auction',
      url: `https://auctions.yahoo.co.jp/search/search?va=${yahooQ}&fixed=0&exflg=1&b=1`,
      hint: 'Principal mercado de subastas en Japón para figuras.'
    },
    {
      id: 'mercari-jp',
      region: 'JP',
      label: 'Mercari JP',
      kind: 'asking',
      url: `https://jp.mercari.com/search?keyword=${enc}`,
      hint: 'C2C Japón; muy usado para figures / Nendoroid / Figma.'
    },
    {
      id: 'amiami',
      region: 'JP',
      label: 'AmiAmi',
      kind: 'retail',
      url: `https://www.amiami.com/eng/search/list/?s_keywords=${encPlus}`,
      hint: 'Precio de tienda / preventa (nuevo).'
    },
    {
      id: 'mandarake',
      region: 'JP',
      label: 'Mandarake',
      kind: 'used-shop',
      url: `https://order.mandarake.co.jp/order/listPage/list?keyword=${enc}&lang=en`,
      hint: 'Tiendas de segunda mano; ancla el mercado JP usado.'
    },
    {
      id: 'hlj',
      region: 'JP',
      label: 'HobbyLink Japan',
      kind: 'retail',
      url: `https://www.hlj.com/search/?q=${enc}`,
      hint: 'Retail / export Japón.'
    }
  ];
}

/**
 * @param {string} query
 */
export function ebayMarketUrls(query) {
  const links = buildMarketLinks(query);
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
  const bits = [item.manufacturer, item.item_number, item.name, item.franchise]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean);
  const seen = new Set();
  return bits
    .filter((b) => {
      const k = b.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(' ');
}
