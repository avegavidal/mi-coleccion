/**
 * Enlaces de mercado US + Japón.
 * Prioriza búsqueda visual (foto) cuando hay imageUrl; texto es respaldo amplio (no título exacto).
 */

/**
 * @param {string} query
 * @param {{ imageUrl?: string|null }} [opts]
 * @returns {{ id: string, region: string, label: string, kind: string, url: string, hint: string }[]}
 */
export function buildMarketLinks(query, opts = {}) {
  const q = (query || '').trim();
  const enc = encodeURIComponent(q);
  const encPlus = encodeURIComponent(q).replace(/%20/g, '+');
  const yahooQ = encodeURIComponent(q);
  const imageUrl = opts.imageUrl ? String(opts.imageUrl).trim() : '';
  const imgEnc = imageUrl ? encodeURIComponent(imageUrl) : '';

  /** @type {ReturnType<typeof buildMarketLinks>} */
  const links = [];

  // —— Búsqueda por imagen (identifica el producto aunque el nombre no coincida) ——
  if (imgEnc) {
    links.push(
      {
        id: 'google-lens',
        region: 'VIS',
        label: 'Google Lens (foto)',
        kind: 'visual',
        url: `https://lens.google.com/uploadbyurl?url=${imgEnc}`,
        hint: 'Identifica la figura por la foto. Suele encontrar eBay, Amazon y shops JP.'
      },
      {
        id: 'bing-visual',
        region: 'VIS',
        label: 'Bing Visual Search',
        kind: 'visual',
        url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:${imgEnc}`,
        hint: 'Búsqueda inversa alternativa; útil si Lens no abre bien en Safari.'
      },
      {
        id: 'google-images',
        region: 'VIS',
        label: 'Google Imágenes',
        kind: 'visual',
        url: `https://www.google.com/searchbyimage?image_url=${imgEnc}&client=app`,
        hint: 'Otra vía de reverse image search.'
      }
    );
  }

  // —— Texto amplio (US) ——
  if (q) {
    links.push(
      {
        id: 'ebay-sold',
        region: 'US',
        label: 'eBay — vendidos',
        kind: 'sold',
        url: `https://www.ebay.com/sch/i.html?_nkw=${enc}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`,
        hint: 'Mejor referencia real (~90 días). Puede pedir login.'
      },
      {
        id: 'ebay-active',
        region: 'US',
        label: 'eBay — en venta',
        kind: 'asking',
        url: `https://www.ebay.com/sch/i.html?_nkw=${enc}&_sop=15&LH_BIN=1&_ipg=60`,
        hint: 'Precios pedidos (Buy It Now).'
      },
      {
        id: 'amazon-us',
        region: 'US',
        label: 'Amazon US',
        kind: 'retail',
        url: `https://www.amazon.com/s?k=${enc}`,
        hint: 'Retail / marketplace EE.UU.'
      },
      {
        id: 'mercari-us',
        region: 'US',
        label: 'Mercari US',
        kind: 'asking',
        url: `https://www.mercari.com/search/?keyword=${enc}`,
        hint: 'Segunda mano en EE.UU.'
      },
      // —— Japón ——
      {
        id: 'amazon-jp',
        region: 'JP',
        label: 'Amazon JP',
        kind: 'retail',
        url: `https://www.amazon.co.jp/s?k=${enc}`,
        hint: 'Amazon Japón (precios en JPY).'
      },
      {
        id: 'yahoo-jp',
        region: 'JP',
        label: 'Yahoo! Auctions JP',
        kind: 'auction',
        url: `https://auctions.yahoo.co.jp/search/search?va=${yahooQ}&fixed=0&exflg=1&b=1`,
        hint: 'Subastas JP — fuerte en figures.'
      },
      {
        id: 'mercari-jp',
        region: 'JP',
        label: 'Mercari JP',
        kind: 'asking',
        url: `https://jp.mercari.com/search?keyword=${enc}`,
        hint: 'C2C Japón.'
      },
      {
        id: 'amiami',
        region: 'JP',
        label: 'AmiAmi',
        kind: 'retail',
        url: `https://www.amiami.com/eng/search/list/?s_keywords=${encPlus}`,
        hint: 'Tienda / preventa.'
      },
      {
        id: 'mandarake',
        region: 'JP',
        label: 'Mandarake',
        kind: 'used-shop',
        url: `https://order.mandarake.co.jp/order/listPage/list?keyword=${enc}&lang=en`,
        hint: 'Segunda mano en tienda JP.'
      },
      {
        id: 'hlj',
        region: 'JP',
        label: 'HobbyLink Japan',
        kind: 'retail',
        url: `https://www.hlj.com/search/?q=${enc}`,
        hint: 'Retail / export.'
      }
    );
  }

  return links;
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
