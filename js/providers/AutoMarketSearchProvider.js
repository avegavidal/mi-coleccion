/**
 * Búsqueda automática de precios de mercado.
 * 1) Gemini + Google Search (si hay API key) → coincidencias con precio
 * 2) eBay vía proxies (fallback)
 * Devuelve matches seleccionables; no solo enlaces.
 */

import { EbayActiveProvider, extractEbayListings, extractEbayPrices } from './EbayActiveProvider.js';
import { lookupTcgPlayerMarket } from './TcgPlayerProvider.js';
import { lookupMercariJpMarket, lookupMercariUsMarket } from './MercariJpProvider.js';
import { ebayMarketUrls, buildShopLinksForQuery, buildVisualMarketLinks, isTcgCardItem, storeLinkForMatch, isDirectListingUrl, isPlausibleListingUrl, matchBelongsToItem, normalizeMarketUrl } from './EbayLinkProvider.js';
import { getUsdJpyRate } from '../utils/dom.js';

function readGeminiApiKey() {
  try {
    if (typeof localStorage !== 'undefined') {
      const fromLs = localStorage.getItem('mi_coleccion_gemini_api_key');
      if (fromLs && fromLs.trim()) return fromLs.trim();
    }
  } catch {
    // ignore
  }
  try {
    return String(globalThis.APP_CONFIG?.GEMINI_API_KEY || globalThis.window?.APP_CONFIG?.GEMINI_API_KEY || '').trim();
  } catch {
    return '';
  }
}

/**
 * @typedef {{
 *  id: string,
 *  title: string,
 *  price: number,
 *  currency: string,
 *  source: string,
 *  url?: string,
 *  query?: string,
 *  score?: number,
 *  note?: string
 * }} MarketMatch
 */

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Búsqueda cancelada'), { name: 'AbortError' }));
      return;
    }
    const t = setTimeout(resolve, Math.max(0, Number(ms) || 0));
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error('Búsqueda cancelada'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @param {MarketMatch[]} matches
 */
export function hasUsefulMarketMatches(matches) {
  return (matches || []).some((m) => Number.isFinite(Number(m?.price)) && Number(m.price) > 0);
}

/**
 * Match “sólido” (anuncio exacto / market TCG / buen score).
 * @param {MarketMatch} m
 */
export function isReliableMatch(m) {
  if (!m || !(Number(m.price) > 0)) return false;
  if (m.source === 'web-snippet') return false;
  if (isTcgMarketPriceMatch(m)) return true;
  if (m.linkExact && (m.score == null || m.score >= 1)) return true;
  if ((m.score || 0) >= 3 && m.source !== 'web-snippet') return true;
  if ((m.score || 0) >= 2 && m.priceType !== 'estimate') return true;
  return false;
}

/**
 * ¿Hay coincidencias suficientemente buenas para dejar de reintentar?
 * Figuras: 1 match decente basta (si exigimos URL exacta, nunca termina).
 * @param {MarketMatch[]} matches
 * @param {object} [item]
 */
export function hasReliableMarketMatches(matches, item = null) {
  const list = matches || [];
  if (!list.length) return false;
  const scored = list.some((m) => m.score != null)
    ? list
    : scoreAndSortMatches(list, item || {});
  return shouldStopMarketSearch(scored, item, 99);
}

/**
 * Criterio de parada por intento. Más permisivo en figuras para no loopear vacío.
 * @param {MarketMatch[]} matches
 * @param {object|null} item
 * @param {number} attempt
 */
export function shouldStopMarketSearch(matches, item, attempt = 1) {
  const list = matches || [];
  if (!list.length) return false;
  const scored = list.some((m) => m.score != null)
    ? [...list].sort((a, b) => (b.score || 0) - (a.score || 0))
    : scoreAndSortMatches(list, item || {});

  const usable = scored.filter((m) =>
    Number(m.price) > 0
    && m.source !== 'web-snippet'
    && (m.score || 0) >= 2
  );

  if (isTcgCardItem(item)) {
    if (scored.some(isTcgMarketPriceMatch)) return true;
    if (usable.some((m) => isReliableMatch(m) && /tcgplayer/i.test(String(m.source || '')))) return true;
    if (attempt >= 3 && usable.some((m) => /tcgplayer|cardmarket/i.test(String(m.source || '')))) return true;
    if (attempt >= 5 && usable.length >= 1) return true;
    return false;
  }

  // Figuras: no parar con un score flojo (evita precio barato de otra pieza)
  if (scored.some((m) => Number(m.price) > 0 && (m.priceVerified || (m.score || 0) >= 6))) {
    return true;
  }
  const solid = scored.filter((m) =>
    Number(m.price) > 0
    && m.source !== 'web-snippet'
    && m.priceType !== 'estimate'
    && (m.score || 0) >= 4
  );
  if (solid.length >= 2 && pricesWithinBand(solid.map((m) => Number(m.price)), 0.4)) {
    return true;
  }
  if (attempt >= 5 && usable.some((m) => (m.score || 0) >= 3)) return true;
  if (attempt >= 5 && scored.some((m) => Number(m.price) > 0 && m.source !== 'web-snippet')) return true;
  return false;
}

/** Precios dentro de ±band de su mediana (band 0.4 = ±40%). */
export function pricesWithinBand(prices, band = 0.4) {
  const nums = (prices || []).map(Number).filter((p) => Number.isFinite(p) && p > 0);
  if (nums.length < 2) return false;
  const med = pickMedian(nums);
  if (!med) return false;
  return nums.every((p) => p <= med * (1 + band) && p >= med * (1 - band));
}

/**
 * Identidad demasiado floja / OCR basura → hay que priorizar la foto.
 * @param {object|null|undefined} item
 */
export function identityWeak(item) {
  const name = String(item?.name || '').replace(/\s+/g, ' ').trim();
  const series = String(item?.series || '').trim();
  const character = String(item?.character_name || item?.character || '').trim();
  const manufacturer = String(item?.manufacturer || '').trim();
  if (series && character) return false;
  if (name.length >= 14 && !/^(thi|the|this|that|sin nombre)\b/i.test(name)) return false;
  if (name.length >= 10 && manufacturer) return false;
  if (manufacturer && series) return false;
  return true;
}

/**
 * @param {object} item
 * @param {{ imageUrl?: string|null, imageBlob?: Blob|File|null, onProgress?: (p:{stage:string,message:string,attempt?:number,matchCount?:number})=>void, onMatches?: (partial:object)=>void, limit?: number, signal?: AbortSignal, maxAttempts?: number }} [opts]
 */
export async function autoSearchMarketMatches(item, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const onMatches = opts.onMatches || (() => {});
  const limit = opts.limit || 12;
  const signal = opts.signal;
  let queries = buildSearchQueries(item);
  const imageUrl = opts.imageUrl || null;
  const imageBlob = opts.imageBlob || null;
  const hasPhoto = Boolean(imageBlob || imageUrl);
  const weakId = identityWeak(item);
  const preferPhoto = hasPhoto && (weakId || !queries.length);
  /** @type {MarketMatch[]} */
  let matches = [];
  const errors = [];
  const apiKey = readGeminiApiKey();
  // Menos intentos: foto + texto en paralelo ya cubren más en el 1.º pase
  const maxAttempts = opts.maxAttempts ?? (apiKey ? (preferPhoto ? 5 : 4) : 2);

  const { resolveGeminiModels } = await import('../services/geminiClient.js');
  let modelList = apiKey
    ? await resolveGeminiModels(apiKey, { forceRefresh: false, purpose: hasPhoto ? 'vision' : 'price' })
    : [];
  let modelCursor = 0;
  let photoGeminiOk = false;
  let lastEmittedCount = -1;

  function snapshotMatches(partial) {
    let list = scoreAndSortMatches(matches, item);
    list = flagPriceOutliers(list);
    list = filterDisplayMatches(list, item).slice(0, limit);
    const tcg = isTcgCardItem(item);
    if (tcg) {
      list = [...list].sort((a, b) => {
        const aM = isTcgMarketPriceMatch(a) ? 1 : 0;
        const bM = isTcgMarketPriceMatch(b) ? 1 : 0;
        if (bM !== aM) return bM - aM;
        return (b.score || 0) - (a.score || 0);
      });
    }
    const useful = hasUsefulMarketMatches(list);
    const primaryQuery = queries[0] || '';
    const shopIds = tcg
      ? ['tcgplayer', 'cardmarket', 'pricecharting', 'mercari-jp', 'ebay-sold', 'ebay-active']
      : ['ebay-sold', 'ebay-active', 'mercari-jp', 'amiami', 'yahoo-jp', 'amazon-jp', 'amazon-us', 'mercari-us'];
    const ref = tcg ? pickTcgReferenceMatch(list) : pickFigureReferenceMatch(list);
    // Mediana solo de anuncios con URL de ficha (precio ≡ lo que hay al abrir)
    const listingPool = list.filter(isPricedListingMatch);
    const medianPrices = listingPool.map((m) => Number(m.price)).filter((p) => p > 0);
    const median = ref?.medianPrice != null && Number.isFinite(Number(ref.medianPrice))
      ? Number(ref.medianPrice)
      : (medianPrices.length ? pickMedian(medianPrices) : null);
    // Preferir anuncios reales; estimates con “Buscar en…” van al final o se ocultan
    let displayList = list;
    if (listingPool.length) {
      displayList = [
        ...(ref && listingPool.some((m) => m.id === ref.id) ? [ref] : []),
        ...listingPool.filter((m) => !ref || m.id !== ref.id)
      ];
      // Deduplicar por id
      const seenIds = new Set();
      displayList = displayList.filter((m) => {
        const id = m.id || `${m.url}|${m.price}`;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });
    } else {
      // Solo orientativos: marcar claramente; no inventar referencia
      displayList = list.map((m) => ({
        ...m,
        searchOnly: !isPlausibleListingUrl(m.url) && !m.linkExact && !m.urlTrusted
      }));
    }
    const reliable = hasReliableMarketMatches(listingPool.length ? listingPool : list, item);
    // Si hay errores de proxy pero también matches → found. Solo "error" si no quedó nada útil.
    const status = useful
      ? 'found'
      : (partial ? 'searching' : (errors.length && !displayList.length ? 'error' : 'empty'));
    const priced = displayList.filter((m) => Number(m.price) > 0);
    return {
      status,
      partial: Boolean(partial),
      matches: useful ? displayList.slice(0, limit) : (partial && displayList.length ? displayList.slice(0, limit) : []),
      queries,
      query: primaryQuery,
      imageUrl,
      errors: errors.slice(-12),
      tcg,
      reference: tcg ? 'tcgplayer-market' : 'median',
      referenceMatchId: ref?.id || null,
      reliable: Boolean(reliable && listingPool.length),
      sampleSize: useful || (partial && displayList.length) ? displayList.length : 0,
      low: medianPrices.length ? Math.min(...medianPrices) : (priced.length ? Math.min(...priced.map((m) => m.price)) : null),
      median: medianPrices.length || ref ? median : null,
      high: medianPrices.length ? Math.max(...medianPrices) : (priced.length ? Math.max(...priced.map((m) => m.price)) : null),
      currency: 'USD',
      links: [
        ...buildVisualMarketLinks(imageUrl),
        ...(primaryQuery
          ? buildShopLinksForQuery(primaryQuery, { tcg }).filter((l) => shopIds.includes(l.id))
          : [])
      ],
      note: useful
        ? (partial
          ? `Encontré ${list.length}… sigo buscando más tiendas`
          : (tcg
            ? (ref
              ? `Referencia: TCGPlayer Market Price $${Number(ref.price).toFixed(2)}. Elige la ideal si hay varias.`
              : `Encontré ${list.length} coincidencia${list.length === 1 ? '' : 's'}. Prefiere la de Market Price.`)
            : (reliable
              ? `Encontré ${list.length} coincidencia${list.length === 1 ? '' : 's'}. Elige la ideal.`
              : `Encontré ${list.length} pista${list.length === 1 ? '' : 's'} (algunas orientativas). Revisa o pulsa “Buscar de nuevo”.`)))
        : !apiKey
          ? 'Para precios automáticos: Configuración → pega tu Gemini API key. Sin ella los marketplaces bloquean la lectura automática.'
          : partial
            ? 'Buscando en tiendas…'
            : status === 'empty'
              ? 'Tras varios intentos no encontré precios útiles. Revisa los datos o abre un buscador manual.'
              : `Tras reintentos no pude leer el mercado (${errors[errors.length - 1] || 'error'}). Puedes pulsar “Buscar de nuevo”.`
    };
  }

  function emitPartial(sourceLabel) {
    const snap = snapshotMatches(true);
    const count = snap.matches?.length || 0;
    if (count !== lastEmittedCount) {
      lastEmittedCount = count;
      onMatches(snap);
      if (count > 0) {
        onProgress({
          stage: 'partial',
          message: sourceLabel
            ? `${count} precio${count === 1 ? '' : 's'} · ${sourceLabel}`
            : `${count} precio${count === 1 ? '' : 's'} encontrados…`,
          matchCount: count
        });
      }
    }
  }

  async function runGeminiPass(attempt) {
    if (!apiKey) return;
    const preferModel = modelList[modelCursor % Math.max(modelList.length, 1)] || 'gemini-2.5-flash-lite';
    modelCursor += 1;
    onProgress({
      stage: 'gemini',
      attempt,
      message: hasPhoto
        ? `Foto + IA (${preferModel}) — si falla prueba otro modelo…`
        : `IA (${preferModel}) + texto — intento ${attempt}…`
    });
    try {
      const geminiMatches = await searchMarketWithGemini(item, {
        apiKey,
        imageUrl,
        imageBlob,
        queries,
        limit,
        preferModel,
        models: modelList,
        signal,
        photoFirst: preferPhoto || hasPhoto,
        purpose: hasPhoto ? 'vision' : 'price'
      });
      if (geminiMatches._imageAttached) photoGeminiOk = true;
      matches = mergeMatches(matches, geminiMatches);
      matches = scoreAndSortMatches(matches, item);
      if ((preferPhoto || weakId) && geminiMatches[0]?.title) {
        const enriched = { ...item, name: item?.name || geminiMatches[0].title };
        const q2 = buildSearchQueries(enriched);
        if (q2.length) queries = q2;
      }
      emitPartial(hasPhoto ? 'foto / Gemini 2.5' : 'Gemini');
    } catch (err) {
      if (err.name === 'AbortError') {
        if (signal?.aborted) throw err;
        errors.push(`Gemini #${attempt}: red interrumpida`);
        return;
      }
      errors.push(`Gemini #${attempt}: ${err.message}`);
      onProgress({
        stage: 'gemini',
        attempt,
        message: `IA falló (${String(err.message).slice(0, 80)}). Sigo con texto…`
      });
      if (/429|cuota|free:|quota/i.test(err.message)) {
        try {
          modelList = await resolveGeminiModels(apiKey, {
            forceRefresh: true,
            purpose: hasPhoto ? 'vision' : 'price'
          });
        } catch {
          // keep
        }
        onProgress({ stage: 'wait', attempt, message: 'Cuota IA agotada — espero unos segundos…' });
        await delay(Math.min(8000, 2500 * attempt), signal);
      }
    }
  }

  async function ingestEbayLive(live, q, attempt, kind) {
    if (!live) return;
    const fromListings = (live.listings || []).map((l, i) => {
      const url = l.url || '';
      const exact = isPlausibleListingUrl(url);
      const searchFallback = live.searchUrl
        || (kind === 'sold' ? ebayMarketUrls(q).sold : ebayMarketUrls(q).active);
      return {
        id: `ebay-${kind}-${attempt}-${q}-${i}-${l.price}`,
        title: l.title || q,
        price: Number(l.price),
        currency: live.currency || 'USD',
        source: 'ebay',
        priceType: kind === 'sold' ? 'sold' : 'listing',
        linkExact: exact,
        urlTrusted: exact,
        url: exact ? url : searchFallback,
        query: q,
        note: exact
          ? (kind === 'sold' ? 'Anuncio eBay (vendido)' : 'Anuncio eBay (en venta)')
          : (kind === 'sold' ? 'eBay vendidos' : 'Listado eBay')
      };
    });
    if (fromListings.length) {
      matches = mergeMatches(matches, fromListings);
      matches = scoreAndSortMatches(matches, item);
      emitPartial(kind === 'sold' ? 'eBay vendidos' : 'eBay');
      return;
    }
    if (live.median == null) return;
    const synth = [];
    const prefix = kind === 'sold' ? 'eBay vendido' : 'eBay';
    for (const [label, price] of [[`${prefix} bajo`, live.low], [`${prefix} típico`, live.median], [`${prefix} alto`, live.high]]) {
      if (price == null) continue;
      synth.push({
        id: `ebay-stat-${kind}-${attempt}-${q}-${label}-${price}`,
        title: `${label}: ${q}`,
        price: Number(price),
        currency: 'USD',
        source: 'ebay',
        priceType: 'estimate',
        linkExact: false,
        url: live.searchUrl,
        query: q,
        note: live.note || `Resumen orientativo eBay (${kind})`
      });
    }
    matches = mergeMatches(matches, synth);
    matches = scoreAndSortMatches(matches, item);
    emitPartial(kind === 'sold' ? 'eBay vendidos' : 'eBay');
  }

  async function runTcgPass(attempt) {
    if (!isTcgCardItem(item)) return;
    const q = [
      item?.item_number,
      [item?.item_number, item?.franchise || item?.series].filter(Boolean).join(' '),
      queries[0],
      item?.name
    ].map((s) => String(s || '').trim()).filter((s) => s.length >= 3);
    const query = [...new Set(q)][0];
    if (!query) return;

    onProgress({
      stage: 'tcgplayer',
      attempt,
      message: `Leyendo Market Price en TCGPlayer (“${query}”)…`
    });
    try {
      const live = await Promise.race([
        lookupTcgPlayerMarket(query, { limit: 6, signal }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout TCGPlayer')), 16000))
      ]);
      if (live?.matches?.length) {
        matches = mergeMatches(matches, live.matches);
        matches = scoreAndSortMatches(matches, item);
        emitPartial('TCGPlayer (página)');
      } else if (live?.note) {
        errors.push(live.note);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        if (signal?.aborted) throw err;
        errors.push('TCGPlayer: red interrumpida');
        return;
      }
      errors.push(`TCGPlayer: ${err.message || err}`);
    }
  }

  /**
   * Mercari JP: misma foto del ítem → Gemini identifica + busca anuncios;
   * además scrape por keyword cuando ya hay nombre.
   */
  async function runMercariPass(attempt) {
    const q = [
      queries[0],
      item?.name,
      [item?.series, item?.character_name].filter(Boolean).join(' '),
      [item?.manufacturer, item?.series].filter(Boolean).join(' ')
    ].map((s) => String(s || '').trim()).filter((s) => s.length >= 3);
    const query = [...new Set(q)][0] || '';

    // 1) Con foto: Gemini + grounding centrado en Mercari JP (misma foto del identify)
    if (apiKey && hasPhoto && attempt <= 2) {
      onProgress({
        stage: 'mercari',
        attempt,
        message: 'Mercari JP por la misma foto…'
      });
      try {
        const preferModel = modelList[modelCursor % Math.max(modelList.length, 1)] || 'gemini-2.5-flash-lite';
        modelCursor += 1;
        const mercariMatches = await searchMercariJpWithGemini(item, {
          apiKey,
          imageUrl,
          imageBlob,
          query,
          preferModel,
          models: modelList,
          signal
        });
        if (mercariMatches._imageAttached) photoGeminiOk = true;
        if (mercariMatches.length) {
          matches = mergeMatches(matches, mercariMatches);
          matches = scoreAndSortMatches(matches, item);
          emitPartial('Mercari JP (foto)');
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          if (signal?.aborted) throw err;
          errors.push('Mercari foto: red interrumpida');
        } else {
          errors.push(`Mercari foto: ${err.message || err}`);
        }
      }
    }

    // 2) Scrape búsqueda Mercari US + JP por keyword (cuando hay texto útil)
    if (!query) return;
    onProgress({
      stage: 'mercari',
      attempt,
      message: `Mercari US/JP (“${query.slice(0, 40)}”)…`
    });
    const mercariJobs = [
      Promise.race([
        lookupMercariUsMarket(query, { limit: 10, signal }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout Mercari US')), 16000))
      ]).then((live) => ({ region: 'US', live })).catch((err) => ({ region: 'US', err })),
      Promise.race([
        lookupMercariJpMarket(query, { limit: 8, signal }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout Mercari JP')), 16000))
      ]).then((live) => ({ region: 'JP', live })).catch((err) => ({ region: 'JP', err }))
    ];
    const mercariResults = await Promise.all(mercariJobs);
    for (const row of mercariResults) {
      if (row.err) {
        if (row.err.name === 'AbortError') {
          if (signal?.aborted) throw row.err;
          errors.push(`Mercari ${row.region}: red interrumpida`);
          continue;
        }
        errors.push(`Mercari ${row.region}: ${row.err.message || row.err}`);
        continue;
      }
      const live = row.live;
      if (live?.matches?.length) {
        matches = mergeMatches(matches, live.matches);
        matches = scoreAndSortMatches(matches, item);
        emitPartial(`Mercari ${row.region}`);
      } else if (live?.note) {
        errors.push(live.note);
      }
    }
  }

  async function runEbayPass(attempt) {
    if (!queries.length) return;
    onProgress({ stage: 'ebay', attempt, message: `Texto / eBay activo+vendidos (intento ${attempt})…` });
    const provider = new EbayActiveProvider();
    const qLimit = attempt === 1 ? 2 : 3;
    for (const q of queries.slice(0, qLimit)) {
      if (shouldStopMarketSearch(matches, item, attempt) && matches.length >= 2) break;
      if (signal?.aborted) break;
      const timed = (p) => Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout eBay')), 10000))
      ]);
      // Activo + vendidos en paralelo (mejor mediana de mercado real)
      const settled = await Promise.allSettled([
        timed(provider.lookup({ query: q, limit: 8 })),
        timed(provider.lookup({ query: q, limit: 8, sold: true }))
      ]);
      if (settled[0].status === 'fulfilled') {
        await ingestEbayLive(settled[0].value, q, attempt, 'active');
      } else {
        errors.push(`eBay activo “${q}”: ${settled[0].reason?.message || settled[0].reason}`);
      }
      if (settled[1].status === 'fulfilled') {
        await ingestEbayLive(settled[1].value, q, attempt, 'sold');
      } else {
        errors.push(`eBay vendidos “${q}”: ${settled[1].reason?.message || settled[1].reason}`);
      }
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Búsqueda cancelada'), { name: 'AbortError' });
    }

    onProgress({
      stage: 'attempt',
      attempt,
      message: hasPhoto && queries.length
        ? `Intento ${attempt}/${maxAttempts}: foto + texto en paralelo…`
        : preferPhoto
          ? `Intento ${attempt}/${maxAttempts}: precio por foto…`
          : `Intento ${attempt}/${maxAttempts}: buscando precio útil…`
    });

    if (!apiKey && attempt === 1) {
      errors.push('Sin Gemini API key: ve a Configuración y guárdala para precios automáticos.');
      onProgress({ stage: 'gemini', message: 'Sin API key de Gemini — precios automáticos limitados…' });
    }

    // Intento 1 con identidad floja + foto: solo foto (Gemini/Mercari), sin eBay por texto basura
    const photoFirstPass = Boolean(hasPhoto && (preferPhoto || weakId) && attempt === 1);
    const tasks = [];
    if (apiKey) tasks.push(runGeminiPass(attempt));
    if (hasPhoto || (!photoFirstPass && queries.length)) {
      const needMercari = attempt === 1
        || (attempt === 2 && !matches.some((m) => /mercari/i.test(String(m.source || ''))));
      if (needMercari) tasks.push(runMercariPass(attempt));
    }
    if (!photoFirstPass && queries.length) tasks.push(runEbayPass(attempt));
    if (!photoFirstPass && isTcgCardItem(item) && (attempt === 1 || !matches.some(isTcgMarketPriceMatch))) {
      tasks.push(runTcgPass(attempt));
    } else if (photoFirstPass && isTcgCardItem(item)) {
      tasks.push(runTcgPass(attempt));
    }
    if (tasks.length) {
      const results = await Promise.allSettled(tasks);
      for (const r of results) {
        if (r.status === 'rejected' && r.reason?.name === 'AbortError' && signal?.aborted) {
          throw r.reason;
        }
      }
    }

    if (shouldStopMarketSearch(matches, item, attempt)) {
      // Con foto débil y Gemini aún sin aportar, dar 1–2 pases más
      if (!(hasPhoto && weakId && !photoGeminiOk && attempt < Math.min(3, maxAttempts))) {
        break;
      }
    }

    if (queries[0] && attempt >= 2 && !shouldStopMarketSearch(matches, item, attempt)) {
      onProgress({ stage: 'web', attempt, message: `Índice web (último recurso, intento ${attempt})…` });
      try {
        const webMatches = await searchPricesViaWebIndex(queries[0], limit, { tcg: isTcgCardItem(item) });
        matches = mergeMatches(matches, webMatches);
        matches = scoreAndSortMatches(matches, item);
        emitPartial('web');
      } catch (err) {
        errors.push(`Web: ${err.message}`);
      }
    }

    if (shouldStopMarketSearch(matches, item, attempt)) break;
    if (attempt >= maxAttempts) break;

    const hasSome = hasUsefulMarketMatches(matches);
    const waitMs = hasSome
      ? Math.min(2500, 700 * attempt)
      : Math.min(10000, Math.round(1200 * (1.3 ** Math.min(attempt - 1, 5))));
    onProgress({
      stage: 'wait',
      attempt,
      message: hasSome
        ? `Mejorando resultados (${attempt + 1}/${maxAttempts})…`
        : `Aún sin precio. Reintento ${attempt + 1}/${maxAttempts}…`,
      matchCount: matches.length
    });
    await delay(waitMs, signal);
  }

  return snapshotMatches(false);
}

function buildSearchQueries(item) {
  const manufacturer = clean(item?.manufacturer);
  const series = clean(item?.series);
  const character = clean(item?.character_name || item?.character);
  const itemNumber = clean(item?.item_number);
  const franchise = clean(item?.franchise);
  const fullName = clean(item?.name);
  const soft = soften(fullName);
  const tcg = isTcgCardItem(item);
  const parts = [];

  if (tcg) {
    // Código de carta primero — es lo que TCGPlayer/eBay indexan bien
    if (itemNumber) {
      parts.push(itemNumber);
      parts.push([itemNumber, franchise || series || 'Union Arena'].filter(Boolean).join(' '));
      parts.push(`${itemNumber} TCGPlayer`);
      if (manufacturer) parts.push([manufacturer, itemNumber].join(' '));
    }
    if (soft && itemNumber && !soft.toUpperCase().includes(itemNumber.toUpperCase())) {
      parts.push([soft, itemNumber].filter(Boolean).join(' '));
    }
    if (soft && (series || franchise) && !itemNumber) {
      parts.push([soft, series || franchise].filter(Boolean).join(' '));
    }
    if (character && (series || franchise) && !itemNumber) {
      parts.push([character, series || franchise].join(' '));
    }
    if (soft && !itemNumber) parts.push(`${soft} TCG`);
  } else {
    // Anclar primero a fabricante + serie + personaje (menos ruido que “buy” genérico)
    if (manufacturer && series && character) {
      parts.push([manufacturer, series, character].join(' '));
      parts.push([manufacturer, series, character, 'figure'].join(' '));
    }
    if (series && character) {
      parts.push([series, character].join(' '));
      parts.push([series, character, 'figure', 'buy'].join(' '));
      parts.push([series, character, manufacturer].filter(Boolean).join(' '));
    }
    if (fullName && fullName.length >= 10) {
      parts.push(fullName);
      parts.push(`${fullName} buy`);
    }
    const buyBase = soft || [series, character].filter(Boolean).join(' ') || fullName;
    if (buyBase) {
      parts.push(`${buyBase} buy`);
      parts.push(`${buyBase} for sale`);
    }
    if (manufacturer && character) parts.push([manufacturer, character, 'figure', 'buy'].join(' '));
    if (soft && soft !== fullName) parts.push(soft);
    if (soft && !/\b(figure|figura|banpresto|nendoroid|figma|glitter)\b/i.test(soft)) {
      parts.push(`${soft} figure buy`);
    }
    if (franchise && character) parts.push([franchise, character, 'figure', 'buy'].join(' '));
    if (manufacturer && itemNumber) parts.push([manufacturer, itemNumber].join(' '));
  }

  const seen = new Set();
  const out = [];
  for (const q of parts) {
    const k = q.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k)) continue;
    const norm = k.split(/\s+/).sort().join(' ');
    if (seen.has(`#${norm}`)) continue;
    seen.add(k);
    seen.add(`#${norm}`);
    out.push(q);
    if (out.length >= 5) break;
  }
  return out;
}

function clean(v) {
  return v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
}

function soften(name) {
  if (!name) return '';
  return name
    .replace(/\b(ver\.?|version|exclusive|limited|edition|special|dx|pre-?order|re-?run)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s\-&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 8)
    .join(' ');
}

/**
 * Búsqueda centrada en Mercari JP usando la MISMA foto del identify.
 * Gemini + Google Search → anuncios jp.mercari.com/item/…
 * @param {object} item
 * @param {{ apiKey: string, imageUrl?: string|null, imageBlob?: Blob|File|null, query?: string, preferModel?: string, models?: string[], signal?: AbortSignal }} opts
 */
export async function searchMercariJpWithGemini(item, opts) {
  const apiKey = opts.apiKey;
  const query = String(opts.query || item?.name || '').trim();
  const meta = [
    item?.name && `Name: ${item.name}`,
    item?.manufacturer && `Manufacturer: ${item.manufacturer}`,
    item?.series && `Series: ${item.series}`,
    item?.character_name && `Character: ${item.character_name}`,
    item?.item_number && `Item #: ${item.item_number}`,
    item?.franchise && `Franchise: ${item.franchise}`
  ].filter(Boolean).join('\n');

  const prompt = `You are a Mercari Japan (jp.mercari.com) price finder for collectible figures / cards.
A product PHOTO is attached — it is the SAME photo the user just took. Find matching listings ON Mercari JP.

Item data (may be incomplete; trust the PHOTO):
${meta || '(identify from PHOTO)'}
Search hint: ${query || '(from PHOTO)'}

Return ONLY valid JSON:
{
  "found": true|false,
  "matches": [
    {
      "title": "listing title",
      "price": 49.99,
      "currency": "USD",
      "source": "mercari",
      "priceType": "listing",
      "url": "https://jp.mercari.com/item/m........",
      "note": "¥xxxx on Mercari JP"
    }
  ]
}
Rules:
- ONLY Mercari JP results (source must be "mercari"). Prefer jp.mercari.com/item/… URLs.
- Convert yen to USD in "price"; put original yen in "note".
- 1–6 matches max. Empty array if none.
- NEVER invent item IDs. If unsure of the exact /item/ URL, use https://jp.mercari.com/search?keyword=...&status=on_sale and set priceType "estimate".
- price is ALWAYS USD after converting from yen (e.g. ¥6200 → ~41.5 USD). Never put 6200 as USD.
- Match the SAME product visible in the photo.`;

  const parts = [{ text: prompt }];
  let imageAttached = false;
  try {
    const imgPart = opts.imageBlob
      ? await blobToInlinePart(opts.imageBlob)
      : (opts.imageUrl ? await fetchImageAsInlinePart(opts.imageUrl) : null);
    if (imgPart) {
      parts.push(imgPart);
      imageAttached = true;
    }
  } catch (err) {
    console.warn('[mercari] no se pudo adjuntar foto', err);
  }
  if (!imageAttached) {
    throw new Error('Sin foto para Mercari JP');
  }

  const {
    geminiGenerateContent,
    geminiTextFromResponse,
    extractGroundingUrls,
    assignGroundingUrlsToMatches
  } = await import('../services/geminiClient.js');

  const bodyWithTools = {
    contents: [{ parts }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1 }
  };

  const out = await geminiGenerateContent(apiKey, bodyWithTools, {
    signal: opts.signal,
    models: opts.models,
    preferModel: opts.preferModel,
    purpose: 'vision'
  });
  const text = geminiTextFromResponse(out.data);
  let parsed = parseGeminiMarketMatches(text, query);
  const grounded = extractGroundingUrls(out.data);
  if (grounded.length) {
    parsed = assignGroundingUrlsToMatches(parsed, grounded);
  }
  parsed = finalizeGeminiMatchUrls(parsed, query);
  // Forzar source mercari y filtrar no-mercari
  const list = parsed
    .map((m) => {
      const url = String(m.url || '');
      const isMercari = /mercari\.com/i.test(url) || /mercari/i.test(String(m.source || ''));
      if (!isMercari && url && !/jp\.mercari\.com\/search/i.test(url)) return null;
      return {
        ...m,
        source: 'mercari',
        id: m.id || `mercari-gemini-${(m.price || 0)}-${(m.title || '').slice(0, 24)}`,
        note: m.note || 'Mercari JP (foto)'
      };
    })
    .filter(Boolean);
  list._imageAttached = true;
  list._model = out.model;
  return list;
}

/**
 * @param {object} item
 * @param {{ apiKey: string, imageUrl?: string|null, imageBlob?: Blob|File|null, queries: string[], limit?: number, preferModel?: string, models?: string[], signal?: AbortSignal, photoFirst?: boolean, purpose?: 'vision'|'price'|'general' }} opts
 * @returns {Promise<MarketMatch[]>}
 */
export async function searchMarketWithGemini(item, opts) {
  const apiKey = opts.apiKey;
  const queries = opts.queries || [];
  const searchHint = queries.join(' | ') || item?.name || '';
  const meta = [
    item?.name && `Name: ${item.name}`,
    item?.manufacturer && `Manufacturer: ${item.manufacturer}`,
    item?.series && `Series: ${item.series}`,
    item?.character_name && `Character: ${item.character_name}`,
    item?.item_number && `Item #: ${item.item_number}`,
    item?.franchise && `Franchise: ${item.franchise}`,
    item?.category && `Category: ${item.category}`
  ].filter(Boolean).join('\n');

  const tcg = isTcgCardItem(item);
  const photoFirst = Boolean(opts.photoFirst);
  const photoBlock = photoFirst
    ? `CRITICAL — PHOTO FIRST:
- A product PHOTO is attached. Identify the EXACT product from the image.
- For TRADING CARDS: read the collector code printed on the card (e.g. EXR-009, OP01-001) and search by THAT CODE on TCGPlayer / eBay.
- For FIGURES: read box text, logos, line (Glitter & Glamours / Nendoroid / G×materia).
- Ignore weak/empty Item data if it conflicts with what you see.
- Prefer real listing URLs. NEVER invent ebay.com/itm/ IDs — if unsure, omit url or use a search page.`
    : '';

  const prompt = `You are a collectible market price assistant (${tcg ? 'TRADING CARD / TCG specialist' : 'ANIME FIGURE / prize figure specialist'}).
${photoBlock}
${tcg
    ? `For TCG cards, the PRIMARY reference price is TCGPlayer "Market Price" (NOT Low Price, NOT Mid listing, NOT listed asking price).
Search TCGPlayer first for the EXACT collector number from the photo/Item # (e.g. EXR-009).
Every match title SHOULD include that collector number when known.
You may also include Cardmarket trend / PriceCharting as secondary options, clearly labeled.
If Item # is present, REJECT results for different card numbers.`
    : `This item is a FIGURE (Banpresto / Bandai Spirits / Good Smile / scale / prize), NOT a trading card.
Search eBay sold/active, AmiAmi, Mercari JP (jp.mercari.com), Yahoo Auctions JP, Amazon for the FIGURE listing.
When a PHOTO is attached, use it to find the SAME figure on Mercari JP — include source "mercari" with jp.mercari.com/item/… URLs and yen→USD prices.
IMPORTANT search style: use the exact product title + "buy" or "for sale" (e.g. "BLEACH Glitter & Glamours Nemu Kurotsuchi buy") to find listings with prices.
DO NOT return TCGPlayer / Cardmarket / PriceCharting card prices even if a same-character TCG card exists.
Include "figure", "Banpresto", or the figure line (e.g. Glitter & Glamours) in the match title when known.`}

Item data:
${meta || '(use the PHOTO — data may be empty or OCR noise)'}

Search hints: ${searchHint || '(derive search terms from the PHOTO — especially collector codes)'}

Return ONLY valid JSON (no markdown) with this shape:
{
  "found": true|false,
  "matches": [
    {
      "title": "product title (MUST include collector code for cards, e.g. EXR-009)",
      "price": 49.99,
      "currency": "USD",
      "source": "${tcg ? 'tcgplayer|cardmarket|pricecharting|ebay|other' : 'ebay|amazon|mercari|amiami|yahoo|other'}",
      "priceType": "${tcg ? 'market|low|mid|listing|estimate' : 'listing|estimate'}",
      "url": "https://...",
      "note": "short why it matches"
    }
  ]
}
Rules:
- price must be a number in USD (never put yen amounts like 6200 in "price" with currency USD — convert JPY→USD first; put original yen only in "note").
- Include 1–8 matches if found; empty array if none.
- CRITICAL: "price" MUST be the price of the exact listing/product at "url". Do not invent prices.
- Prefer REAL listing URLs: ebay.com/itm/..., amazon.com/dp/..., jp.mercari.com/item/..., mercari.com/item/..., amiami.com/.../detail/...${tcg ? ', tcgplayer.com/product/...' : ''}.
- For Japan secondhand figures, include Mercari JP (jp.mercari.com) when possible.
- NEVER invent or guess ebay.com/itm/######## URLs. If you do not have a verified listing URL, leave url empty or use a store SEARCH url — the app will build a safe search.
- If you cannot find the listing URL, set priceType to "estimate" and say so in note. Still set source correctly.
${tcg
    ? `- CRITICAL: at least one match MUST be TCGPlayer Market Price when available, with "source":"tcgplayer" and "priceType":"market" and note "TCGPlayer Market Price".
- Prefer Near Mint Market Price; put foil / alternate art as separate matches.
- Do NOT use Low Price as the main reference.
- Match the SAME collector number as Item # / photo code.`
    : `- If multiple variants exist (A/B colorways, open box vs sealed), include several so the user can pick.
- Never substitute a trading-card price for a figure.`}
- Never claim a store listing price without a matching product/listing url when one exists.`;

  const parts = [{ text: prompt }];
  let imageAttached = false;

  try {
    const imgPart = opts.imageBlob
      ? await blobToInlinePart(opts.imageBlob)
      : (opts.imageUrl ? await fetchImageAsInlinePart(opts.imageUrl) : null);
    if (imgPart) {
      parts.push(imgPart);
      imageAttached = true;
    }
  } catch (err) {
    console.warn('[market] no se pudo adjuntar foto a Gemini', err);
  }

  if (photoFirst && !imageAttached) {
    throw new Error('No pude adjuntar la foto a la IA — reintenta');
  }

  const {
    geminiGenerateContent,
    geminiTextFromResponse,
    formatGeminiHttpError,
    extractGroundingUrls,
    assignGroundingUrlsToMatches
  } = await import('../services/geminiClient.js');

  const bodyPlain = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };
  const bodyWithTools = {
    contents: [{ parts }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1 }
  };

  const genOpts = {
    signal: opts.signal,
    models: opts.models,
    preferModel: opts.preferModel,
    purpose: opts.purpose || (photoFirst ? 'vision' : 'price')
  };

  // Preferir grounding web primero: mejores URLs reales de anuncios.
  let lastErr = '';
  try {
    const out = await geminiGenerateContent(apiKey, bodyWithTools, genOpts);
    const text = geminiTextFromResponse(out.data);
    let parsed = parseGeminiMarketMatches(text, searchHint);
    const grounded = extractGroundingUrls(out.data);
    if (grounded.length) {
      parsed = assignGroundingUrlsToMatches(parsed, grounded);
    }
    parsed = finalizeGeminiMatchUrls(parsed, searchHint);
    parsed._imageAttached = imageAttached;
    parsed._model = out.model;
    if (parsed.length) return parsed;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (opts.signal?.aborted) throw err;
      lastErr = 'Red interrumpida';
    } else {
      lastErr = err.message;
    }
  }

  try {
    const out = await geminiGenerateContent(apiKey, bodyPlain, genOpts);
    const text = geminiTextFromResponse(out.data);
    let parsed = finalizeGeminiMatchUrls(parseGeminiMarketMatches(text, searchHint), searchHint);
    parsed._imageAttached = imageAttached;
    parsed._model = out.model;
    return parsed;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (opts.signal?.aborted) throw err;
      throw new Error(String(err.message || lastErr || 'Red interrumpida').slice(0, 280));
    }
    throw new Error(String(err.message || lastErr || formatGeminiHttpError(0, '')).slice(0, 280));
  }
}

/**
 * @param {string} text
 * @param {string} searchHint
 * @returns {MarketMatch[]}
 */
/**
 * Corrige yen mal etiquetado como USD (p. ej. 6200 → ~$41.5).
 * @param {{ price?: number, currency?: string, source?: string, note?: string, priceType?: string }} m
 * @returns {{ price: number, currency: string, originalYen?: number, note: string, skipped?: boolean }}
 */
export function normalizeMatchPriceToUsd(m) {
  let price = Number(m?.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { price: 0, currency: 'USD', note: String(m?.note || ''), skipped: true };
  }
  let currency = String(m?.currency || 'USD').toUpperCase();
  if (currency === 'YEN') currency = 'JPY';
  const note = String(m?.note || '');
  const source = String(m?.source || '').toLowerCase();
  const blob = `${source} ${note}`.toLowerCase();
  const rate = getUsdJpyRate() || 149;

  const yenFromNote = (() => {
    const a = note.match(/¥\s*([\d,]+)/);
    if (a) return Number(String(a[1]).replace(/,/g, ''));
    const b = note.match(/([\d,]+)\s*(?:JPY|円|yen)\b/i);
    if (b) return Number(String(b[1]).replace(/,/g, ''));
    return null;
  })();

  const looksJpMarket = /mercari|yahoo|amiami|mandarake|\.jp\b|円/.test(blob);
  const integerLike = Math.abs(price - Math.round(price)) < 0.001;
  // IA suele pegar yenes (6200, 9800…) en "price" con currency USD
  const yenAsUsd = currency === 'USD'
    && integerLike
    && price >= 1000
    && price <= 2_000_000
    && (
      (yenFromNote != null && Math.abs(yenFromNote - price) < 1)
      || looksJpMarket
      || (String(m?.priceType || '').toLowerCase() === 'estimate' && price >= 2000)
    );

  if (currency === 'JPY' || yenAsUsd) {
    const yen = currency === 'JPY' ? price : price;
    const usd = Math.round((yen / rate) * 100) / 100;
    if (!(usd > 0)) return { price: 0, currency: 'USD', note, skipped: true };
    return {
      price: usd,
      currency: 'USD',
      originalYen: yen,
      note: note
        ? `${note} · convertido ¥${yen.toLocaleString('ja-JP')}→USD`
        : `Convertido ¥${yen.toLocaleString('ja-JP')}→USD`
    };
  }

  // Estimates absurdos sin scrapear (p. ej. $6200 figura prize)
  if (String(m?.priceType || '').toLowerCase() === 'estimate' && price > 2500 && !looksJpMarket) {
    return { price: 0, currency: 'USD', note, skipped: true };
  }

  return { price, currency: currency === 'USD' ? 'USD' : currency, note };
}

export function parseGeminiMarketMatches(text, searchHint = '') {
  const parsed = parseJsonObject(text);
  if (!parsed) throw new Error('Gemini no devolvió JSON de precios');

  const raw = Array.isArray(parsed.matches) ? parsed.matches : [];
  /** @type {MarketMatch[]} */
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i] || {};
    const title = String(m.title || searchHint || 'Coincidencia').trim();
    const source = String(m.source || 'web');
    const rawUrl = typeof m.url === 'string' ? m.url.trim() : '';
    const normUrl = normalizeMarketUrl(rawUrl);
    let priceType = String(m.priceType || inferPriceType(m)).toLowerCase();
    // Gemini no verifica el precio en la página: siempre estimate
    if (priceType === 'listing' || priceType === 'market') {
      priceType = 'estimate';
    }
    const noteBase = m.note
      ? String(m.note)
      : 'Precio orientativo (IA) — no leído de la ficha';
    const normalized = normalizeMatchPriceToUsd({
      price: m.price,
      currency: m.currency,
      source,
      note: noteBase,
      priceType
    });
    if (normalized.skipped || !(normalized.price > 0)) continue;
    const price = normalized.price;
    const searchTitle = sanitizeMatchTitle(title);
    // eBay /itm/ de Gemini suelen 404 → no usar. Mercari/AmiAmi plausibles se dejan
    // vacíos para que el grounding pueda rellenar; si no, búsqueda (sin fingir precio de ficha).
    const ebayFake = /ebay\./i.test(normUrl || '') && /\/itm\//i.test(normUrl || '');
    const keepUrl = normUrl && isPlausibleListingUrl(normUrl) && !ebayFake ? normUrl : '';
    out.push({
      id: `gem-${i}-${price}-${title.slice(0, 24)}`,
      title: searchTitle || title,
      price,
      currency: 'USD',
      source,
      priceType,
      priceVerified: false,
      url: keepUrl,
      linkExact: Boolean(keepUrl),
      urlTrusted: false,
      query: searchHint,
      note: normalized.note || noteBase,
      originalYen: normalized.originalYen,
      searchOnly: !keepUrl
    });
  }
  // finalizeGeminiMatchUrls se llama DESPUÉS del grounding (searchMarketWithGemini)
  return out;
}

/**
 * Tras grounding: si no hay URL de ficha, poner búsqueda (precio sigue siendo orientativo).
 * @param {MarketMatch[]} matches
 * @param {string} searchHint
 */
export function finalizeGeminiMatchUrls(matches, searchHint = '') {
  return (matches || []).map((m) => {
    if (m.url && isPlausibleListingUrl(m.url)) {
      return { ...m, linkExact: true, searchOnly: false };
    }
    const openUrl = storeLinkForMatch({
      source: m.source,
      title: m.title,
      url: '',
      query: searchHint || m.query,
      price: m.price,
      urlTrusted: false
    });
    return {
      ...m,
      url: openUrl,
      linkExact: false,
      urlTrusted: false,
      searchOnly: true,
      note: m.note || 'Solo búsqueda — el precio puede no coincidir con el primer anuncio'
    };
  });
}

function sanitizeMatchTitle(title) {
  return String(title || '')
    .replace(/\uFFFD/g, '')
    .replace(/[^\p{L}\p{N}\s\-&:×x.'+/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function inferPriceType(m) {
  const blob = `${m?.note || ''} ${m?.title || ''} ${m?.source || ''}`.toLowerCase();
  if (/market\s*price|precio\s*(de\s*)?mercado/.test(blob)) return 'market';
  if (/\blow\b|lowest/.test(blob)) return 'low';
  if (/\bmid\b|median/.test(blob)) return 'mid';
  if (/estimad|estimate/.test(blob)) return 'estimate';
  return 'listing';
}

/** True si el match es el Market Price de TCGPlayer verificado (leído de la página). */
export function isTcgMarketPriceMatch(m) {
  if (!m) return false;
  if (m.priceVerified === true && String(m.source || '').toLowerCase() === 'tcgplayer') {
    return String(m.priceType || '').toLowerCase() === 'market'
      || /market\s*price/i.test(String(m.note || ''));
  }
  return false;
}

/**
 * Elige la coincidencia de referencia TCG: Market Price TCGPlayer.
 * @param {MarketMatch[]} matches
 */
export function pickTcgReferenceMatch(matches) {
  const list = matches || [];
  const market = list.filter(isTcgMarketPriceMatch);
  if (market.length) {
    return [...market].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  }
  const tcg = list.filter((m) => String(m.source || '').toLowerCase() === 'tcgplayer');
  if (tcg.length) {
    return [...tcg].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  }
  return list[0] || null;
}

/**
 * Anuncio con precio + URL de ficha real (no búsqueda). Precio debe coincidir al abrir.
 * @param {MarketMatch} m
 */
export function isPricedListingMatch(m) {
  if (!m || !(Number(m.price) > 0)) return false;
  if (m.source === 'web-snippet') return false;
  const url = String(m.url || '');
  const exact = Boolean(m.urlTrusted || m.linkExact || isPlausibleListingUrl(url));
  if (!exact) return false;
  // Estimates de IA sin scrapear: no anclar precio a un /item/ dudoso
  if (m.priceType === 'estimate' && !m.urlTrusted && !m.priceVerified) return false;
  return true;
}

/**
 * Referencia de figuras: mediana de anuncios reales → enlace al ítem más cercano a esa mediana.
 * El precio mostrado es el del anuncio (así coincide al abrir el link).
 * @param {MarketMatch[]} matches
 */
export function pickFigureReferenceMatch(matches) {
  const list = matches || [];
  const solid = list.filter(isPricedListingMatch);
  if (solid.length >= 2) {
    const med = pickMedian(solid.map((m) => Number(m.price)));
    if (med != null) {
      const closest = [...solid].sort((a, b) =>
        Math.abs(Number(a.price) - med) - Math.abs(Number(b.price) - med)
        || (b.score || 0) - (a.score || 0)
      )[0];
      return {
        ...closest,
        isMedianAnchor: true,
        medianPrice: med,
        medianSampleSize: solid.length,
        note: `Mediana ~$${Number(med).toFixed(2)} de ${solid.length} anuncios · enlace al más cercano ($${Number(closest.price).toFixed(2)})`
      };
    }
  }
  if (solid.length === 1) {
    return { ...solid[0], isMedianAnchor: false, medianSampleSize: 1 };
  }
  const verified = list.filter((m) => m.priceVerified && Number(m.price) > 0 && isPricedListingMatch(m));
  if (verified.length) {
    return [...verified].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  }
  // Sin anuncios reales: no usar estimates con link de búsqueda como referencia
  return null;
}

async function blobToInlinePart(blob) {
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  const mime = blob.type || 'image/jpeg';
  return { inline_data: { mime_type: mime, data: b64 } };
}

async function fetchImageAsInlinePart(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) return null;
  return blobToInlinePart(await res.blob());
}

function parseJsonObject(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/**
 * @param {MarketMatch[]} a
 * @param {MarketMatch[]} b
 */
export function mergeMatches(a, b) {
  const out = [...(a || [])];
  const key = (m) => `${String(m.title || '').toLowerCase().slice(0, 60)}|${Number(m.price).toFixed(2)}`;
  const seen = new Set(out.map(key));
  for (const m of b || []) {
    if (!m || !Number.isFinite(Number(m.price))) continue;
    const k = key(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

/**
 * @param {MarketMatch[]} matches
 * @param {object} item
 */
export function scoreAndSortMatches(matches, item) {
  const tcgItem = isTcgCardItem(item);
  const codeRaw = String(item?.item_number || '').trim().toUpperCase();
  const codeNorm = codeRaw.replace(/[^A-Z0-9]/g, '');
  const tokens = [
    item?.series, item?.character_name, item?.character, item?.manufacturer,
    item?.item_number, item?.franchise, ...(String(item?.name || '').split(/\s+/))
  ]
    .map((t) => String(t || '').toLowerCase())
    .filter((t) => t.length > 2);

  return [...(matches || [])]
    .map((m) => {
      const title = String(m.title || '').toLowerCase();
      const src = String(m.source || '').toLowerCase();
      const blob = `${title} ${src} ${m.note || ''}`.toLowerCase();
      const titleNorm = title.replace(/[^a-z0-9]/g, '');
      let score = 0;
      for (const t of tokens) {
        if (title.includes(t.toLowerCase())) score += 2;
      }
      // Código de carta: bonus fuerte si coincide; penaliza si es otra carta
      if (codeNorm.length >= 4) {
        if (title.includes(codeRaw.toLowerCase()) || titleNorm.includes(codeNorm.toLowerCase())) {
          score += 18;
        } else if (tcgItem) {
          score -= 14;
        }
      }
      // Market Price leído de la página (no IA)
      if (m.priceVerified && isTcgMarketPriceMatch(m)) score += 30;
      else if (m.priceVerified) score += 12;
      if (m.linkExact || isDirectListingUrl(m.url)) score += 4;
      if (m.urlTrusted && m.priceVerified) score += 6;
      if (/mercari\.com\/(?:us\/)?item\//i.test(String(m.url || '')) && m.urlTrusted) score += 3;
      if (m.priceType === 'estimate') score -= 1;
      // Yen-as-USD ya convertido suele quedar bajo; estimates sin ficha pierden vs scrape US
      if (m.priceType === 'estimate' && Number(m.price) > 800) score -= 3;
      if (m.priceVerified !== true && /tcgplayer/i.test(src) && m.priceType === 'estimate') score -= 4;
      if (m.priceType === 'sold') score += 1; // vendidos ≈ precio real de mercado
      if (src === 'web-snippet') score -= 6;
      if (isTcgMarketPriceMatch(m)) score += 6;
      else if (src === 'tcgplayer') score += tcgItem ? 3 : -8;
      if (src === 'ebay' || src === 'amiami' || src === 'mercari' || src === 'yahoo') score += 2;
      if (src === 'amazon') score += 1;
      if (src === 'cardmarket' || src === 'pricecharting') score += tcgItem ? 2 : -8;
      // Penalizar cruce figura ↔ carta
      if (!tcgItem && /tcgplayer|cardmarket|pricecharting|trading\s*card|\bholo\b|\bnm\b\s*market/i.test(blob)) {
        score -= 10;
      }
      if (tcgItem && /\b(banpresto|nendoroid|figma|glitter\s*&?\s*glamours|prize\s*figure|scale\s*figure)\b/i.test(blob)) {
        score -= 8;
      }
      if (!tcgItem && /\b(figure|figura|banpresto|nendoroid|glitter|figma|amiami)\b/i.test(blob)) {
        score += 2;
      }
      return { ...m, score };
    })
    .sort((a, b) => (b.score - a.score) || (a.price - b.price));
}

/**
 * Baja score de precios muy lejos de la mediana (ruido).
 * @param {MarketMatch[]} matches
 */
export function flagPriceOutliers(matches) {
  const list = matches || [];
  const prices = list
    .filter((m) => m.priceType !== 'estimate' && m.source !== 'web-snippet')
    .map((m) => Number(m.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length < 3) return list;
  const med = pickMedian(prices);
  if (!med) return list;
  return list.map((m) => {
    const p = Number(m.price);
    if (!(p > 0)) return m;
    if (p > med * 3.5 || p < med / 3.5) {
      return {
        ...m,
        score: (m.score || 0) - 4,
        note: `${m.note || 'Coincidencia'} · precio atípico vs resto`.trim()
      };
    }
    return m;
  }).sort((a, b) => (b.score || 0) - (a.score || 0) || (a.price - b.price));
}

/**
 * Quita matches irrelevantes si hay mejores; si solo hay flojos, deja los top.
 * @param {MarketMatch[]} matches
 * @param {object} item
 */
export function filterDisplayMatches(matches, item) {
  const list = matches || [];
  if (!list.length) return list;
  const tcgItem = isTcgCardItem(item);
  const solidId = item && !identityWeak(item);
  const hasListings = list.some(isPricedListingMatch);
  const filtered = list.filter((m) => {
    const blob = `${m.title || ''} ${m.source || ''} ${m.note || ''}`.toLowerCase();
    // Si hay anuncios reales, ocultar estimates solo-búsqueda (precio ≠ lo del link)
    if (hasListings && !isPricedListingMatch(m) && (m.priceType === 'estimate' || m.source === 'web-snippet')) {
      return false;
    }
    if (solidId && item && !matchBelongsToItem(m, item)) {
      return false;
    }
    if (item && !matchBelongsToItem(m, item) && (m.score || 0) < 6) {
      return false;
    }
    if (!tcgItem && /tcgplayer|cardmarket|pricecharting/.test(String(m.source || '').toLowerCase()) && (m.score || 0) < 2) {
      return false;
    }
    if (!tcgItem && /\b(trading\s*card|tcg\s*market)\b/i.test(blob) && (m.score || 0) < 3) {
      return false;
    }
    if ((m.score || 0) < 0 && list.some((x) => (x.score || 0) >= 3)) return false;
    return true;
  });
  const keep = filtered.length
    ? filtered
    : (solidId
      ? list.filter((m) => matchBelongsToItem(m, item) && (!hasListings || isPricedListingMatch(m)))
      : list.filter((m) => !item || matchBelongsToItem(m, item) || (m.score || 0) >= 4));
  const finalKeep = keep.length ? keep : (solidId ? [] : list);
  if (finalKeep.some(isPricedListingMatch) || finalKeep.some(isReliableMatch)) {
    return finalKeep.filter((m) => m.source !== 'web-snippet');
  }
  return finalKeep;
}

async function searchPricesViaWebIndex(query, limit = 8, opts = {}) {
  const tcg = Boolean(opts.tcg);
  const qPrimary = encodeURIComponent(
    tcg ? `${query} TCGPlayer "Market Price"` : `${query} buy OR "for sale" price ebay OR amiami OR mercari`
  );
  const qAlt = encodeURIComponent(
    tcg ? `${query} card price` : `${query} Banpresto OR figure buy sold`
  );
  const targets = [
    `https://r.jina.ai/http://www.bing.com/search?q=${qPrimary}`,
    `https://r.jina.ai/http://www.bing.com/search?q=${qAlt}`,
    `https://r.jina.ai/http://html.duckduckgo.com/html/?q=${qPrimary}`
  ];
  const out = [];
  for (const url of targets) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const text = await res.text();
      const pairRe = /([A-Za-z0-9][^$\n]{8,100}?)\s+\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g;
      let m;
      while ((m = pairRe.exec(text)) !== null && out.length < limit) {
        const title = m[1].replace(/\s+/g, ' ').trim();
        const price = Number(String(m[2]).replace(/,/g, ''));
        if (!Number.isFinite(price) || price < 0.25 || price > 20000) continue;
        if (/cookie|privacy|sign in|results|filter/i.test(title)) continue;
        // No fingir fuente TCGPlayer: son snippets ruidosos
        out.push({
          id: `web-${out.length}-${price}`,
          title: title.slice(0, 160),
          price,
          currency: 'USD',
          source: 'web-snippet',
          priceType: 'estimate',
          linkExact: false,
          query,
          note: 'Pista web (orientativa)',
          url: storeLinkForMatch({
            source: tcg ? 'tcgplayer' : 'ebay',
            title: title.slice(0, 160),
            query,
            price
          })
        });
      }
      if (out.length) break;
    } catch {
      // next
    }
  }
  return out;
}

function pickMedian(nums) {
  const s = [...nums].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
}

// Re-export helpers used by tests / callers
export { extractEbayListings, extractEbayPrices };
