import { el, toast, imageTypeLabel, setBusy, formatMoneyDual, openExternal, setMarketSearching } from '../utils/dom.js';
import { prepareImageForAnalysis } from '../utils/imageCrop.js';
import { navigate } from '../utils/router.js';
import {
  recognizeImage,
  formatSimilarity,
  saveIdentificationHistory,
  checkWishlistHints
} from '../services/recognitionService.js';
import {
  isClearSimilarityMatch,
  markNameAlignedMatches
} from '../utils/similarity.js';
import { incrementQuantity, getItem, listItems } from '../services/collectionService.js';
import { getSignedUrls, listItemImages } from '../services/imageService.js';
import { warmupEmbeddings } from '../services/embeddingService.js';
import { identifyFigureFromPhoto, preferBetterSuggestion, suggestionFromMarketMatches } from '../services/visionIdentifyService.js';
import {
  lookupMarketPrice,
  buildInstantMarket,
  classifyDeal,
  buildMarketProbeFromSuggestion
} from '../services/marketPriceService.js';
import { isTcgCardItem, listingLinkMeta } from '../providers/EbayLinkProvider.js';
import { isTcgMarketPriceMatch } from '../providers/AutoMarketSearchProvider.js';

/** Estado de la sesión de identificación en memoria */
if (typeof globalThis !== 'undefined') {
  globalThis.__identifyState = globalThis.__identifyState || null;
}

export async function renderIdentify(root) {
  root.append(el('div', { className: 'page identify-page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Identificar' }),
      el('p', {
        className: 'page-sub',
        text: 'Dos búsquedas en paralelo: ¿la tienes? y ¿a qué precio está?'
      })
    ]),
    el('div', { className: 'identify-actions' }, [
      el('label', { className: 'btn btn-primary btn-xl btn-block', html: '📷 Tomar foto<input type="file" accept="image/*" capture="environment" id="id-cam" hidden>' }),
      el('label', { className: 'btn btn-ghost btn-block', html: 'Seleccionar foto<input type="file" accept="image/*" id="id-gal" hidden>' })
    ]),
    el('div', { id: 'id-model-status', className: 'model-status muted' }),
    el('div', { id: 'id-workspace' })
  ]));

  const status = root.querySelector('#id-model-status');
  status.textContent = 'Preparando modelo visual (solo la primera vez descarga ~100 MB, gratis y en tu iPhone)…';

  warmupEmbeddings((p) => {
    status.textContent = p.status === 'loading'
      ? `Descargando modelo… ${p.progress || 0}%`
      : p.status === 'ready'
        ? 'Modelo listo. Puedes tomar una foto.'
        : `Modelo: ${p.status}`;
  }).catch((err) => {
    status.textContent = `Modelo no listo: ${err.message}. Revisa la conexión e inténtalo de nuevo.`;
  });

  const prev = globalThis.__identifyState;
  if (prev?.previewUrl && (prev.result || prev.marketResult || prev.suggestion)) {
    const workspace = root.querySelector('#id-workspace');
    const shell = mountIdentifyShell(workspace, prev.previewUrl);
    if (prev.result) {
      paintCollectionTrack(shell, prev.result, prev.previewUrl);
      shell.collectionStatus.textContent = 'Comparación con tu colección';
    } else {
      shell.collectionStatus.textContent = 'Sin resultado de colección guardado';
    }
    wireMarketTrack(shell, prev.previewUrl, {
      suggestion: prev.suggestion || null,
      marketResult: prev.marketResult || null,
      // Solo saltar auto si ya hubo una búsqueda automática completa
      autoStart: !(prev.marketResult?.auto && !prev.marketResult?.instant)
    });
  }

  const onFile = async (file) => {
    if (!file) return;
    abortIdentifyMarket();
    const workspace = root.querySelector('#id-workspace');
    let compressed;
    try {
      compressed = await prepareImageForAnalysis(file, { cropTitle: 'Recortar figura a identificar' });
      if (!compressed) return;
    } catch (err) {
      toast(err.message, 'error');
      return;
    }

    const previewUrl = URL.createObjectURL(compressed);
    globalThis.__identifyState = {
      file: compressed,
      previewUrl,
      result: null,
      suggestion: null,
      marketResult: null
    };

    const shell = mountIdentifyShell(workspace, previewUrl);

    // Flujo A — colección (CLIP). Independiente.
    runCollectionTrack(shell, compressed, previewUrl);

    // Flujo B — precio (visión + mercado). En paralelo, no espera a A.
    wireMarketTrack(shell, previewUrl, {
      file: compressed,
      autoStart: true
    });
  };

  root.querySelector('#id-cam').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    onFile(f);
  });
  root.querySelector('#id-gal').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    onFile(f);
  });
}

function abortIdentifyMarket() {
  try {
    globalThis.__identifyMarketAbort?.abort();
  } catch { /* ignore */ }
  globalThis.__identifyMarketAbort = null;
}

/**
 * @param {object|null} suggestion
 * @param {object} result
 */
export function buildIdentifyProbeItem(suggestion, result) {
  return buildMarketProbeFromSuggestion(suggestion, result);
}

function mountIdentifyShell(workspace, previewUrl) {
  workspace.innerHTML = '';
  workspace.append(
    el('section', { className: 'section' }, [
      el('h2', { text: 'Foto' }),
      el('div', { className: 'preview-frame large' }, [el('img', { src: previewUrl, alt: 'Foto nueva' })])
    ]),
    el('div', { className: 'identify-tracks', id: 'identify-tracks' }, [
      el('section', { className: 'section identify-track identify-track-collection', id: 'track-collection' }, [
        el('div', { className: 'identify-track-head' }, [
          el('p', { className: 'identify-track-label', text: 'Flujo 1' }),
          el('h2', { text: '¿La tengo en mi colección?' }),
          el('p', { className: 'page-sub', text: 'Compara la foto con tus piezas (CLIP local).' })
        ]),
        el('p', { id: 'id-collection-status', className: 'status-line muted', text: 'Buscando en tu colección…' }),
        el('div', { id: 'id-collection-cta', className: 'identify-collection-cta' }),
        el('div', { id: 'id-collection-body', className: 'identify-track-body' })
      ]),
      el('section', { className: 'section market-panel identify-track identify-track-market', id: 'track-market' }, [
        el('div', { className: 'identify-track-head market-panel-head' }, [
          el('p', { className: 'identify-track-label', text: 'Flujo 2' }),
          el('h2', { text: 'Precio de mercado' }),
          el('p', { className: 'page-sub', text: 'En paralelo: detecta la pieza y busca precio.' })
        ]),
        el('div', { className: 'market-toolbar' }, [
          el('div', { id: 'id-market-status', className: 'status-line muted', text: '…' }),
          el('button', { type: 'button', className: 'btn btn-ghost hidden', id: 'id-market-cancel', text: 'Detener' }),
          el('button', { type: 'button', className: 'btn btn-ghost', id: 'id-market-refresh', text: 'Buscar de nuevo' })
        ]),
        el('div', {
          className: 'market-search-progress',
          id: 'id-market-progress',
          role: 'progressbar',
          'aria-label': 'Buscando precio de mercado',
          'aria-hidden': 'true'
        }),
        el('p', { id: 'id-detected', className: 'muted small identify-detected' }),
        el('div', { className: 'identify-ask-row' }, [
          el('label', {}, [
            el('span', { text: '¿A qué precio la viste? (opcional)' }),
            el('input', {
              className: 'input',
              id: 'id-asking-price',
              type: 'number',
              step: '0.01',
              min: '0',
              inputmode: 'decimal',
              placeholder: 'Ej. 45'
            })
          ])
        ]),
        el('div', { id: 'id-market-deal', className: 'market-deal hidden' }),
        el('div', { id: 'id-market-body', className: 'market-body' })
      ])
    ])
  );

  return {
    collectionStatus: workspace.querySelector('#id-collection-status'),
    collectionCta: workspace.querySelector('#id-collection-cta'),
    collectionBody: workspace.querySelector('#id-collection-body'),
    marketStatus: workspace.querySelector('#id-market-status'),
    marketProgress: workspace.querySelector('#id-market-progress'),
    marketPanel: workspace.querySelector('#track-market'),
    marketBody: workspace.querySelector('#id-market-body'),
    marketDeal: workspace.querySelector('#id-market-deal'),
    detectedEl: workspace.querySelector('#id-detected'),
    askingInput: workspace.querySelector('#id-asking-price'),
    cancelBtn: workspace.querySelector('#id-market-cancel'),
    refreshBtn: workspace.querySelector('#id-market-refresh')
  };
}

async function runCollectionTrack(shell, file, previewUrl) {
  const { collectionStatus, collectionBody, collectionCta } = shell;
  collectionStatus.textContent = 'Analizando y buscando en tu colección…';
  if (collectionCta) collectionCta.innerHTML = '';
  collectionBody.innerHTML = '';
  collectionBody.append(el('p', { className: 'muted', text: 'Esto no espera al precio de mercado.' }));

  try {
    const result = await recognizeImage(file, {
      onProgress: (p) => {
        if (collectionStatus) collectionStatus.textContent = p.message || p.stage || 'Buscando…';
      },
      onModelProgress: (p) => {
        if (collectionStatus && p.progress != null) {
          collectionStatus.textContent = `Modelo visual ${p.progress}%`;
        }
      }
    });
    if (globalThis.__identifyState) globalThis.__identifyState.result = result;
    paintCollectionTrack(shell, result, previewUrl);
    const n = (result.strongMatches?.length || 0) + (result.weakMatches?.length || 0);
    const sims = [
      ...(result.strongMatches || []).map((m) => Number(m.similarity) || 0),
      ...(result.weakMatches || []).map((m) => Number(m.similarity) || 0)
    ].sort((a, b) => b - a);
    const high = result.settings?.high_similarity_threshold ?? 0.88;
    const clear = isClearSimilarityMatch(sims[0] || 0, sims[1] || 0, result.settings || {});
    const best = sims[0] || 0;
    const pct = Math.round(high * 100);
    collectionStatus.textContent = clear
      ? `${n} posible${n === 1 ? '' : 's'} · mejor ${formatSimilarity(best)}`
      : n
        ? `Ninguna clara al ${pct}%+ (mejor ${formatSimilarity(best)}) — revisa o agrega nueva`
        : 'No aparece en tu colección';
  } catch (err) {
    console.error(err);
    collectionStatus.textContent = err.message || 'Error al buscar en colección';
    if (collectionCta) collectionCta.innerHTML = '';
    collectionBody.innerHTML = '';
    collectionBody.append(el('p', { className: 'error-text', text: err.message }));
  }
}

function paintCollectionTrack(shellOrHost, result, previewUrl, suggestion = null) {
  // Compat: remount pasa collectionBody; flujo normal pasa shell completo
  const host = shellOrHost?.collectionBody || shellOrHost;
  const ctaHost = shellOrHost?.collectionCta
    || host?.closest?.('#track-collection')?.querySelector('#id-collection-cta')
    || null;
  if (!host || !result) return;
  host.innerHTML = '';
  if (ctaHost) ctaHost.innerHTML = '';

  const settings = result.settings || {
    high_similarity_threshold: 0.88,
    medium_similarity_threshold: 0.78,
    low_similarity_threshold: 0.58
  };
  const CLEAR_MIN = Number(settings.high_similarity_threshold) || 0.88;
  const pct = Math.round(CLEAR_MIN * 100);
  const sug = suggestion || globalThis.__identifyState?.suggestion || null;

  let strongMatches = markNameAlignedMatches(result.strongMatches || [], sug, settings);
  let weakMatches = markNameAlignedMatches(result.weakMatches || [], sug, settings);
  // Preferentes (nombre+visual) primero dentro de cada banda
  const prefer = (a, b) => (b.preferredCandidate ? 1 : 0) - (a.preferredCandidate ? 1 : 0)
    || (Number(b.similarity) || 0) - (Number(a.similarity) || 0);
  strongMatches = [...strongMatches].sort(prefer);
  weakMatches = [...weakMatches].sort(prefer);

  const sims = [
    ...strongMatches.map((m) => Number(m.similarity) || 0),
    ...weakMatches.map((m) => Number(m.similarity) || 0)
  ].sort((a, b) => b - a);
  const hasClearMatch = isClearSimilarityMatch(sims[0] || 0, sims[1] || 0, settings);
  const hasAny = strongMatches.length + weakMatches.length > 0;

  const addNewBtn = (primary) =>
    el('button', {
      type: 'button',
      id: primary ? 'identify-primary-add' : 'identify-secondary-add',
      className: primary ? 'btn btn-primary btn-block' : 'btn btn-ghost btn-block',
      text: primary ? 'Agregar figura nueva' : 'No es ninguna — agregar nueva',
      onClick: async () => {
        try {
          await saveIdentificationHistory({
            results: summarize(result),
            outcome: 'added_new'
          });
        } catch { /* optional */ }
        globalThis.__pendingIdentifyFile = globalThis.__identifyState?.file;
        navigate('add');
      }
    });

  const putCta = (node) => {
    if (ctaHost) ctaHost.append(node);
    else host.prepend(node);
  };

  if (!hasClearMatch) {
    putCta(
      el('div', { className: 'notice notice-warn identify-add-sticky', id: 'identify-add-block' }, [
        el('h3', { text: hasAny ? `Ninguna coincide al ${pct}%+` : 'No hay coincidencia clara' }),
        el('p', {
          text: hasAny
            ? 'Las parecidas abajo son solo orientación. Si no estás seguro, agrégala como nueva.'
            : 'Puedes agregarla como nueva a tu colección.'
        }),
        addNewBtn(true)
      ])
    );
  }

  // Solo el mejor (con gap) cuenta como claro; el resto son “parecidas”
  const topClear = hasClearMatch
    ? strongMatches.find((m) => (Number(m.similarity) || 0) >= CLEAR_MIN
      && (Number(m.similarity) || 0) === sims[0])
    : null;
  const clearList = topClear ? [topClear] : [];
  const maybeStrong = strongMatches.filter((m) => m !== topClear);

  if (clearList.length) {
    host.append(
      el('p', {
        className: 'muted',
        text: `Posible coincidencia clara (≥${pct}% y separada del resto). Confirma tú.`
      }),
      el('div', { className: 'match-list', id: 'strong-list' })
    );
    const strongList = host.querySelector('#strong-list');
    for (const m of clearList) strongList.append(matchCard(m, previewUrl, { clear: true }));
  }

  if (maybeStrong.length) {
    host.append(
      el('p', {
        className: 'muted',
        text: `Parecidas por debajo del ${pct}% o sin separación clara — no se confirma.`
      }),
      el('div', { className: 'match-list', id: 'maybe-list' })
    );
    const maybeList = host.querySelector('#maybe-list');
    for (const m of maybeStrong) maybeList.append(matchCard(m, previewUrl, { clear: false }));
  }

  if (weakMatches.length) {
    host.append(
      el('h3', { text: 'Parecidas (baja)' }),
      el('div', { className: 'match-list', id: 'weak-list' })
    );
    const weakList = host.querySelector('#weak-list');
    for (const m of weakMatches) weakList.append(matchCard(m, previewUrl, { clear: false }));
  }

  if (hasClearMatch && hasAny) {
    putCta(addNewBtn(false));
  }
}

/**
 * Cuando la web da el nombre oficial, buscar también por texto en la colección.
 */
async function refreshCollectionByName(shell, suggestion, previewUrl) {
  const name = String(suggestion?.name || '').trim();
  if (!name || name.length < 4) return;
  const { collectionBody, collectionStatus } = shell;
  if (!collectionBody) return;

  // Query corta: serie + personaje o primeras palabras útiles
  const tokens = name
    .replace(/[^\p{L}\p{N}\s×x]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !/^(the|and|for|with|from|banpresto|bandai)$/i.test(t));
  const q = [suggestion.series, suggestion.character_name, ...tokens.slice(0, 4)]
    .filter(Boolean)
    .join(' ')
    .slice(0, 80) || name.slice(0, 60);

  try {
    const items = await listItems({ search: q, sort: 'name' });
    if (!items.length) return;

    const paths = items
      .map((it) => (it.item_images || []).sort((a, b) => String(a.image_type).localeCompare(String(b.image_type)))[0]?.storage_path)
      .filter(Boolean);
    const urls = await getSignedUrls(paths, 3600, { variant: 'thumb' });

    const nameMatches = items.slice(0, 6).map((it) => {
      const img = (it.item_images || [])[0];
      return {
        itemId: it.id,
        name: it.name,
        franchise: it.franchise,
        manufacturer: it.manufacturer,
        collectionName: it.collections?.name,
        similarity: null,
        level: 'name',
        bestImageUrl: img ? urls[img.storage_path] : null,
        bestImageId: img?.id || null,
        fromNameSearch: true
      };
    });

    // Prefijar bloque de matches por nombre sin empujar el CTA "agregar nueva"
    let nameHost = collectionBody.querySelector('#name-match-block');
    if (!nameHost) {
      nameHost = el('div', { id: 'name-match-block' });
      collectionBody.prepend(nameHost);
    }
    nameHost.innerHTML = '';
    nameHost.append(
      el('p', {
        className: 'muted small',
        text: `Por nombre web (“${q}”) — no es similitud visual. Confirma con la foto.`
      }),
      el('div', { className: 'match-list', id: 'name-match-list' })
    );
    const list = nameHost.querySelector('#name-match-list');
    for (const m of nameMatches) list.append(matchCard(m, previewUrl, { clear: false, byName: true }));

    if (collectionStatus && /No aparece|Buscando|Analizando|Ninguna al/i.test(collectionStatus.textContent || '')) {
      collectionStatus.textContent = `${nameMatches.length} por nombre · revisa también similitud visual`;
    }
  } catch (err) {
    console.warn('[identify] name search failed', err);
  }
}

/**
 * Flujo B: visión + mercado. No depende del flujo de colección.
 */
function wireMarketTrack(shell, previewUrl, opts = {}) {
  const {
    marketStatus,
    marketBody,
    marketDeal,
    detectedEl,
    askingInput,
    cancelBtn,
    refreshBtn,
    marketProgress,
    marketPanel
  } = shell;

  const showSearching = (on) => setMarketSearching(marketProgress, on, marketPanel);

  let suggestion = opts.suggestion || null;
  let latestProbe = buildIdentifyProbeItem(suggestion, globalThis.__identifyState?.result || null);

  const paintDeal = (marketResult) => {
    if (!marketDeal) return;
    const ask = Number(askingInput?.value);
    const median = marketResult?.median;
    if (!Number.isFinite(ask) || ask <= 0 || median == null) {
      marketDeal.className = 'market-deal muted';
      marketDeal.classList.remove('hidden');
      marketDeal.textContent = median != null
        ? `Referencia ~${formatMoneyDual(median, marketResult.currency || 'USD')}. Escribe el precio pedido para ver si es buen trato.`
        : 'Cuando haya precio de mercado, escribe lo que te piden para comparar.';
      return;
    }
    const deal = classifyDeal(ask, median);
    marketDeal.className = `market-deal deal-${deal.code || 'unknown'}`;
    marketDeal.classList.remove('hidden');
    marketDeal.innerHTML = '';
    marketDeal.append(
      el('strong', { text: deal.label || 'Sin veredicto' }),
      el('p', { text: deal.detail || '' })
    );
  };

  const paintMarket = (marketResult) => {
    paintIdentifyMarketBody(marketBody, marketResult, latestProbe);
    paintDeal(marketResult);
    if (globalThis.__identifyState) {
      // No guardar el placeholder instantáneo como “resultado listo” (bloqueaba autoStart al remount)
      if (marketResult?.auto && !marketResult?.instant) {
        globalThis.__identifyState.marketResult = marketResult;
      }
      globalThis.__identifyState.suggestion = suggestion;
    }
  };

  const setDetected = (s) => {
    suggestion = s;
    latestProbe = buildIdentifyProbeItem(suggestion, globalThis.__identifyState?.result || null);
    if (detectedEl) {
      const via = suggestion?.source === 'market-web'
        ? ' (web/precios)'
        : suggestion?.source === 'gemini-web'
          ? ' (IA + web)'
          : suggestion?.source === 'ocr'
            ? ' (OCR — puede fallar)'
            : '';
      detectedEl.textContent = suggestion?.name
        ? `Pieza: ${suggestion.name}${suggestion.manufacturer ? ` · ${suggestion.manufacturer}` : ''}${via}`
        : 'Sin nombre detectado — se busca por foto.';
    }
    if (globalThis.__identifyState) globalThis.__identifyState.suggestion = suggestion;
  };

  const applyWebIdentity = (marketResult) => {
    const fromMarket = suggestionFromMarketMatches(marketResult?.matches || []);
    const better = preferBetterSuggestion(suggestion, fromMarket);
    if (better && better !== suggestion) {
      setDetected(better);
      // Reconsulta colección por nombre oficial (paralelo al CLIP visual)
      refreshCollectionByName(shell, better, previewUrl);
    }
  };

  let autoRefineDone = false;
  let lookupGen = 0;
  let userCancelled = false;
  let abortRetryUsed = false;

  const runMarketLookup = (force = false) => {
    // Abortar búsqueda anterior sin marcarla como “Detener” del usuario
    abortIdentifyMarket();
    userCancelled = false;
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    globalThis.__identifyMarketAbort = ac;
    const gen = ++lookupGen;
    cancelBtn?.classList.remove('hidden');
    showSearching(true);
    marketStatus.textContent = 'Buscando precios…';
    latestProbe = buildIdentifyProbeItem(suggestion, globalThis.__identifyState?.result || null);
    paintMarket(buildInstantMarket(latestProbe, { imageUrl: previewUrl }));
    const fileBlob = opts.file || globalThis.__identifyState?.file || null;

    lookupMarketPrice(latestProbe, {
      imageUrl: previewUrl,
      imageBlob: fileBlob,
      signal: ac?.signal,
      maxAttempts: force ? 6 : 5,
      onProgress: (p) => {
        if (gen !== lookupGen) return;
        if (marketStatus) marketStatus.textContent = p.message || p.stage || 'Buscando…';
      },
      onMatches: (partial) => {
        if (gen !== lookupGen) return;
        paintMarket(partial);
        const n = partial.matches?.length || 0;
        if (n > 0 && marketStatus) {
          marketStatus.textContent = `${n} tienda${n === 1 ? '' : 's'} · sigo buscando…`;
        }
      }
    }).then((marketResult) => {
      if (gen !== lookupGen) return;
      showSearching(false);
      cancelBtn?.classList.add('hidden');
      const nameBefore = suggestion?.name || '';
      const probeBefore = buildIdentifyProbeItem(suggestion, globalThis.__identifyState?.result || null);
      applyWebIdentity(marketResult);
      const nameAfter = suggestion?.name || '';
      latestProbe = buildIdentifyProbeItem(suggestion, globalThis.__identifyState?.result || null);

      import('../providers/AutoMarketSearchProvider.js').then(({ identityWeak }) => {
        if (gen !== lookupGen) return;
        const wasWeak = identityWeak(probeBefore);
        const nowSolid = !identityWeak(latestProbe);
        const weakResults = marketResult.status !== 'found'
          || !marketResult.matches?.length
          || !marketResult.reliable;
        const nameImproved = nameAfter && nameAfter !== nameBefore
          && nameAfter.length >= Math.max(8, nameBefore.length);
        // Reconsultar si la identidad pasó de floja→sólida, o si mejoró el nombre y aún no hay precio fiable
        if (!autoRefineDone && ((wasWeak && nowSolid) || (weakResults && nameImproved))) {
          autoRefineDone = true;
          marketStatus.textContent = 'Identidad mejorada — buscando precio…';
          runMarketLookup(true);
          return;
        }
        paintMarket(marketResult);
        marketStatus.textContent = marketResult.status === 'found'
          ? (marketResult.matches?.length > 1
            ? `${marketResult.matches.length} precios · identidad: ${suggestion?.name || 'foto'}`
            : `Precio encontrado · ${suggestion?.name || 'foto'}`)
          : (marketResult.note || 'Sin precio automático');
      }).catch(() => {
        paintMarket(marketResult);
        marketStatus.textContent = marketResult.note || 'Sin precio automático';
      });
    }).catch((err) => {
      if (gen !== lookupGen) return; // reemplazada por otra búsqueda — ignorar
      showSearching(false);
      cancelBtn?.classList.add('hidden');
      if (err?.name === 'AbortError') {
        if (userCancelled) {
          marketStatus.textContent = 'Búsqueda detenida';
          userCancelled = false;
          return;
        }
        // Abort espurio (proxy/adblock): un solo reintento automático
        if (!abortRetryUsed) {
          abortRetryUsed = true;
          marketStatus.textContent = 'Conexión interrumpida — reintentando…';
          setTimeout(() => {
            if (gen === lookupGen) runMarketLookup(true);
          }, 800);
          return;
        }
        marketStatus.textContent = 'No se pudo completar la búsqueda. Pulsa “Buscar de nuevo”.';
        return;
      }
      marketStatus.textContent = err.message || 'Error al buscar precio';
    });
  };

  const runMarketPipeline = async () => {
    marketStatus.textContent = 'Identificando el ítem por foto…';
    showSearching(true);
    setDetected(suggestion);
    const file = opts.file || globalThis.__identifyState?.file;

    // Esperar identificación completa (Gemini o OCR) — la foto de precio necesita el mejor nombre posible
    if (file) {
      try {
        const s = await identifyFigureFromPhoto(file, {
          onProgress: (p) => {
            if (!marketStatus) return;
            const raw = String(p?.message || '').trim();
            marketStatus.textContent = /identificando|buscando el producto|reintentando/i.test(raw)
              ? raw
              : 'Identificando el ítem por foto…';
          }
        });
        setDetected(preferBetterSuggestion(suggestion, s));
        if (suggestion?.name) {
          refreshCollectionByName(shell, suggestion, previewUrl);
          // Re-pintar matches CLIP con fusión nombre+visual
          if (globalThis.__identifyState?.result) {
            paintCollectionTrack(shell, globalThis.__identifyState.result, previewUrl, suggestion);
          }
        }
      } catch (err) {
        console.warn('[identify] vision for market failed', err);
      }
    }

    // Pausa corta si se usó Gemini, para no encadenar 429
    if (suggestion?.source === 'gemini-web' || suggestion?.source === 'gemini') {
      marketStatus.textContent = 'Identidad lista — preparando búsqueda de precio…';
      await new Promise((r) => setTimeout(r, 2000));
    }

    const { identityWeak } = await import('../providers/AutoMarketSearchProvider.js');
    latestProbe = buildIdentifyProbeItem(suggestion, globalThis.__identifyState?.result || null);
    if (identityWeak(latestProbe) && fileBlobOrState(opts)) {
      marketStatus.textContent = 'Identidad floja — 1.er pase solo por foto…';
    } else if (!suggestion?.name) {
      marketStatus.textContent = 'OCR flojo — busco precio directo por la foto…';
    }
    runMarketLookup(false);
  };

  function fileBlobOrState(o) {
    return Boolean(o?.file || globalThis.__identifyState?.file);
  }

  askingInput?.addEventListener('input', () => {
    paintDeal(globalThis.__identifyState?.marketResult || null);
  });
  cancelBtn?.addEventListener('click', () => {
    userCancelled = true;
    abortIdentifyMarket();
    showSearching(false);
    cancelBtn.classList.add('hidden');
    marketStatus.textContent = 'Deteniendo…';
  });
  refreshBtn?.addEventListener('click', () => runMarketLookup(true));

  if (opts.marketResult) {
    setDetected(suggestion);
    paintMarket(opts.marketResult);
    marketStatus.textContent = opts.marketResult.status === 'found'
      ? 'Precio de esta foto'
      : (opts.marketResult.note || 'Sin precio automático');
  } else if (opts.autoStart) {
    runMarketPipeline();
  } else {
    setDetected(suggestion);
    marketStatus.textContent = 'Pulsa “Buscar de nuevo” para precios';
  }
}

function paintIdentifyMarketBody(host, result, probe) {
  if (!host) return;
  host.innerHTML = '';
  if (!result) {
    host.append(el('p', { className: 'muted', text: 'Sin datos de mercado aún.' }));
    return;
  }

  const currency = result.currency || 'USD';
  const matches = Array.isArray(result.matches) ? result.matches : [];
  const tcg = Boolean(result.tcg) || isTcgCardItem(probe);

  if (result.auto && matches.length && (result.status === 'found' || result.status === 'searching' || result.partial)) {
    const list = el('div', { className: 'market-match-list' });
    for (const match of matches) {
      const isMarketRef = isTcgMarketPriceMatch(match) || result.referenceMatchId === match.id;
      const link = listingLinkMeta(match, probe);
      const href = link.url;
      const card = el('a', {
        className: `market-match-card is-store-link${isMarketRef ? ' is-market-ref' : ''}${link.exact ? '' : ' is-search-link'}`,
        href: href || '#',
        target: '_blank',
        rel: 'noopener noreferrer'
      }, [
        el('div', { className: 'market-match-main' }, [
          el('strong', {
            className: 'market-match-price',
            text: formatMoneyDual(match.price, match.currency || currency)
          }),
          match.isMedianAnchor
            ? el('span', { className: 'market-ref-badge', text: 'Mediana' })
            : (isMarketRef ? el('span', { className: 'market-ref-badge', text: 'Market Price' }) : null),
          !link.exact ? el('span', { className: 'market-ref-badge market-est-badge', text: 'Orientativo' }) : null,
          el('p', { className: 'market-match-title', text: match.title || 'Sin título' }),
          el('p', {
            className: 'muted small',
            text: [
              match.source,
              link.exact ? (match.priceType || 'listing') : 'orientativo · búsqueda',
              match.note
            ].filter(Boolean).join(' · ')
          }),
          el('span', { className: 'market-match-open', text: link.label })
        ])
      ]);
      card.addEventListener('click', (e) => {
        e.preventDefault();
        if (!link.exact) {
          toast('Orientativo: al buscar, el primer anuncio puede tener otro precio', 'info');
        }
        if (!openExternal(href)) toast('No hay enlace válido para esta tienda', 'error');
      });
      list.append(card);
    }
    host.append(list);
  } else if (result.auto && (result.status === 'empty' || result.status === 'error')) {
    host.append(el('div', { className: 'notice notice-warn' }, [
      el('p', { text: result.note || 'No pude leer precios automáticos.' })
    ]));
  }

  if (result.median != null) {
    host.append(el('div', { className: 'market-stats' }, [
      el('div', { className: 'market-stat main' }, [
        el('span', { className: 'market-stat-label', text: tcg ? 'Market Price' : 'Referencia' }),
        el('strong', { text: formatMoneyDual(result.median, currency) })
      ])
    ]));
  }

  const details = el('details', { className: 'market-fallback' }, [
    el('summary', { text: 'Abrir buscadores (Lens / tiendas)' })
  ]);
  const links = [
    ...(result.visualLinks || []),
    ...(result.links || []).filter((l) => l.kind !== 'visual' && l.region !== 'VIS')
  ].slice(0, 10);
  if (links.length) {
    details.append(el('div', { className: 'market-query-links' },
      links.map((l) => el('a', {
        className: 'market-chip',
        href: l.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: l.label || l.id
      }))
    ));
    host.append(details);
  }
}

function summarize(result) {
  return (result.matches || []).slice(0, 10).map((m) => ({
    itemId: m.itemId,
    name: m.name,
    similarity: m.similarity
  }));
}

function matchCard(match, previewUrl, opts = {}) {
  const sim = Number(match.similarity);
  const hasSim = Number.isFinite(sim) && sim > 0;
  const clear = Boolean(opts.clear);
  const byName = Boolean(opts.byName || match.fromNameSearch);
  const tag = byName
    ? 'Solo por nombre (no visual)'
    : clear
      ? 'Posible coincidencia clara'
      : match.preferredCandidate
        ? 'Candidata (nombre + foto)'
        : hasSim
          ? 'Parecida — no confirmada'
          : 'Revisar';
  const levelClass = clear
    ? 'level-high'
    : (match.preferredCandidate || match.level === 'medium' ? 'level-medium' : 'level-low');
  return el('article', { className: `match-card ${levelClass}` }, [
    el('div', { className: 'match-photo' }, [
      match.bestImageUrl
        ? el('img', {
          src: match.bestImageUrl,
          alt: match.name,
          loading: 'lazy',
          decoding: 'async',
          width: 120,
          height: 160
        })
        : el('div', { className: 'photo-placeholder', text: '?' })
    ]),
    el('div', { className: 'match-body' }, [
      el('p', { className: 'match-tag', text: tag }),
      el('h3', { text: match.name }),
      el('p', { className: 'muted', text: [match.franchise, match.manufacturer, match.collectionName].filter(Boolean).join(' · ') }),
      hasSim
        ? el('p', { className: 'sim-score', text: `${formatSimilarity(sim)} de similitud visual` })
        : el('p', { className: 'sim-score muted', text: 'Sin % visual — coincidencia por texto' }),
      el('button', {
        type: 'button',
        className: clear ? 'btn btn-primary btn-block' : 'btn btn-ghost btn-block',
        text: 'Ver comparación',
        onClick: () => {
          globalThis.__identifyState = {
            ...globalThis.__identifyState,
            selectedMatch: match,
            previewUrl
          };
          navigate(`compare/${match.itemId}`);
        }
      })
    ])
  ]);
}

export async function renderCompare(root, params) {
  const itemId = params[0];
  const state = globalThis.__identifyState;
  if (!state?.file || !itemId) {
    root.append(
      el('div', { className: 'page' }, [
        el('p', { text: 'No hay una identificación en curso.' }),
        el('a', { href: '#/identify', className: 'btn btn-primary', text: 'Identificar' })
      ])
    );
    return;
  }

  const match = state.selectedMatch || state.result?.matches?.find((m) => m.itemId === itemId);
  const item = await getItem(itemId);
  let images = item.item_images || [];
  if (!images.length) images = await listItemImages(itemId);
  const urlMap = await getSignedUrls(images.map((i) => i.storage_path));
  images = images.map((i) => ({ ...i, url: urlMap[i.storage_path] }));

  let index = 0;
  if (match?.bestImageId) {
    const idx = images.findIndex((i) => i.id === match.bestImageId);
    if (idx >= 0) index = idx;
  }

  const wishlistHints = await checkWishlistHints({
    name: item.name,
    itemNumber: item.item_number
  });

  root.append(el('div', { className: 'page compare-page' }, [
    el('header', { className: 'page-header' }, [
      el('a', { href: '#/identify', className: 'back-link', text: '← Coincidencias' }),
      el('h1', { text: 'Comparación visual' }),
      el('p', { className: 'page-sub', text: 'Confirma si corresponde a esta pieza.' })
    ]),
    wishlistHints.length
      ? el('div', { className: 'notice notice-info', text: 'Esta pieza está en tu lista de deseos (o tiene un nombre similar).' })
      : null,
    el('div', { className: 'compare-grid' }, [
      el('div', { className: 'compare-pane' }, [
        el('h3', { text: 'Foto nueva' }),
        el('div', { className: 'preview-frame' }, [
          el('img', { src: state.previewUrl, alt: 'Nueva' })
        ])
      ]),
      el('div', { className: 'compare-vs', text: 'VS' }),
      el('div', { className: 'compare-pane' }, [
        el('h3', { text: 'Mi colección' }),
        el('div', { className: 'preview-frame', id: 'coll-photo' }),
        el('div', { className: 'swiper-controls' }, [
          el('button', { type: 'button', className: 'btn btn-ghost', id: 'prev-img', text: '←' }),
          el('span', { id: 'img-caption', className: 'muted' }),
          el('button', { type: 'button', className: 'btn btn-ghost', id: 'next-img', text: '→' })
        ])
      ])
    ]),
    el('div', { className: 'compare-info' }, [
      el('h2', { text: item.name }),
      el('p', { className: 'muted', text: [item.franchise, item.manufacturer, item.collections?.name].filter(Boolean).join(' · ') }),
      el('p', { className: 'sim-score', text: match ? `${formatSimilarity(match.similarity)} de similitud visual` : '' })
    ]),
    el('div', { className: 'btn-stack' }, [
      el('button', { type: 'button', className: 'btn btn-primary btn-xl btn-block', id: 'btn-yes', text: '✓ Esta es' }),
      el('button', { type: 'button', className: 'btn btn-ghost btn-block', id: 'btn-no', text: '✕ No es' })
    ]),
    el('div', { id: 'confirm-panel', className: 'confirm-panel hidden' })
  ]));

  const collPhoto = root.querySelector('#coll-photo');
  const caption = root.querySelector('#img-caption');

  const paint = () => {
    const img = images[index];
    collPhoto.innerHTML = '';
    if (!img) {
      collPhoto.append(el('div', { className: 'photo-placeholder', text: 'Sin fotos' }));
      caption.textContent = '';
      return;
    }
    collPhoto.append(el('img', { src: img.url || '', alt: imageTypeLabel(img.image_type) }));
    caption.textContent = `${imageTypeLabel(img.image_type)} (${index + 1}/${images.length})`;
  };
  paint();

  // Swipe support
  let touchX = null;
  collPhoto.addEventListener('touchstart', (e) => {
    touchX = e.changedTouches[0].screenX;
  }, { passive: true });
  collPhoto.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].screenX - touchX;
    if (dx > 50) index = (index - 1 + images.length) % Math.max(images.length, 1);
    if (dx < -50) index = (index + 1) % Math.max(images.length, 1);
    paint();
    touchX = null;
  }, { passive: true });

  root.querySelector('#prev-img').addEventListener('click', () => {
    if (!images.length) return;
    index = (index - 1 + images.length) % images.length;
    paint();
  });
  root.querySelector('#next-img').addEventListener('click', () => {
    if (!images.length) return;
    index = (index + 1) % images.length;
    paint();
  });

  root.querySelector('#btn-no').addEventListener('click', () => {
    navigate('identify');
    // Re-show results without re-running model
    setTimeout(() => {
      const ws = document.querySelector('#id-workspace');
      if (ws && state.result) {
        // Full re-render of identify is cleaner
        location.hash = '#/identify';
      }
    }, 0);
    toast('Vuelve a la lista y elige otra, o agrega como nueva.', 'info');
  });

  root.querySelector('#btn-yes').addEventListener('click', () => {
    const panel = root.querySelector('#confirm-panel');
    panel.classList.remove('hidden');
    panel.innerHTML = '';
    panel.append(
      el('div', { className: 'notice notice-ok' }, [
        el('h2', { text: 'Esta pieza ya está en tu colección.' }),
        el('p', { text: `Cantidad actual: ${item.quantity}` }),
        el('p', { className: 'muted', text: 'No se creará un registro duplicado automáticamente.' }),
        el('div', { className: 'btn-stack' }, [
          el('a', { href: `#/item/${item.id}`, className: 'btn btn-primary btn-block', text: 'Ver pieza' }),
          el('button', {
            type: 'button',
            className: 'btn btn-ghost btn-block',
            id: 'inc-qty',
            text: '+ Agregar otra unidad'
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-ghost btn-block',
            id: 'cancel-confirm',
            text: 'Cancelar'
          })
        ])
      ])
    );

    panel.querySelector('#cancel-confirm').addEventListener('click', () => {
      panel.classList.add('hidden');
    });

    panel.querySelector('#inc-qty').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, 'Actualizando…');
      try {
        const updated = await incrementQuantity(item.id, 1);
        await saveIdentificationHistory({
          results: summarize(state.result),
          selectedItemId: item.id,
          selectedSimilarity: match?.similarity,
          outcome: 'confirmed'
        });
        toast(`Cantidad: ${updated.quantity}`, 'ok');
        navigate(`item/${item.id}`);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setBusy(btn, false);
      }
    });

    // Also log when viewing without increment
    saveIdentificationHistory({
      results: summarize(state.result),
      selectedItemId: item.id,
      selectedSimilarity: match?.similarity,
      outcome: 'confirmed'
    }).catch(() => {});
  });
}
