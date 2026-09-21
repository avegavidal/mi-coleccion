import { el, emptyState, toast, setBusy, imageTypeLabel, formatMoney, formatMoneyDual, formatDate, openExternal } from '../utils/dom.js';
import { prepareImageForAnalysis } from '../utils/imageCrop.js';
import { itemCard } from './dashboard.js';
import {
  listItems, listCollections, createItem, getItem, updateItem,
  deleteItem, incrementQuantity, getDuplicateItems
} from '../services/collectionService.js';
import { enrichItemsWithThumbs } from '../services/exportService.js';
import { uploadItemImage, deleteImageRecord, getSignedUrl, getSignedUrls } from '../services/imageService.js';
import {
  buildInstantMarket,
  lookupMarketPrice,
  saveManualMarketPrice,
  classifyDeal,
  getCachedMarketView,
  saveMarketCache,
  clearMarketCache
} from '../services/marketPriceService.js';
import { identifyFigureFromPhoto } from '../services/visionIdentifyService.js';
import { isTcgCardItem, listingLinkMeta } from '../providers/EbayLinkProvider.js';
import { isTcgMarketPriceMatch } from '../providers/AutoMarketSearchProvider.js';
import { navigate } from '../utils/router.js';

export async function renderCollection(root) {
  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header row-between' }, [
      el('div', {}, [
        el('h1', { text: 'Mi colección' }),
        el('p', { className: 'page-sub', text: 'Busca, filtra y organiza.' })
      ]),
      el('div', { className: 'btn-row' }, [
        el('a', { href: '#/collections', className: 'btn btn-ghost btn-round', text: '▣' }),
        el('a', { href: '#/add', className: 'btn btn-primary btn-round', text: '+' })
      ])
    ]),
    el('div', { className: 'filters' }, [
      el('input', { type: 'search', id: 'q', placeholder: 'Buscar nombre, marca, serie…', className: 'input' }),
      el('select', { id: 'filter-collection', className: 'input' }, [el('option', { value: '', text: 'Todas las categorías' })]),
      el('select', { id: 'sort', className: 'input' }, [
        el('option', { value: 'recent', text: 'Más recientes' }),
        el('option', { value: 'name', text: 'Nombre' }),
        el('option', { value: 'quantity', text: 'Cantidad' }),
        el('option', { value: 'value', text: 'Valor' })
      ]),
      el('button', { type: 'button', className: 'btn btn-ghost', id: 'apply-filters', text: 'Aplicar' })
    ]),
    el('div', { className: 'card-grid', id: 'items-grid' })
  ]));

  const collections = await listCollections();
  const sel = root.querySelector('#filter-collection');
  for (const c of collections) {
    sel.append(el('option', { value: c.id, text: c.name }));
  }

  const load = async () => {
    const grid = root.querySelector('#items-grid');
    grid.innerHTML = '<p class="muted">Cargando…</p>';
    try {
      const items = await listItems({
        search: root.querySelector('#q').value,
        collection_id: root.querySelector('#filter-collection').value || undefined,
        sort: root.querySelector('#sort').value
      });
      const withThumbs = await enrichItemsWithThumbs(items);
      grid.innerHTML = '';
      if (!withThumbs.length) {
        grid.append(emptyState('Sin resultados', 'Prueba otra búsqueda o agrega una pieza.'));
        return;
      }
      for (const item of withThumbs) grid.append(itemCard(item));
    } catch (err) {
      grid.innerHTML = `<p class="error-text">${err.message}</p>`;
    }
  };

  root.querySelector('#apply-filters').addEventListener('click', load);
  root.querySelector('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') load();
  });
  let searchTimer = null;
  root.querySelector('#q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 450);
  });
  await load();
}

export async function renderAdd(root, params = []) {
  const prefillPhoto = window.__pendingIdentifyFile || null;
  const collections = await listCollections();

  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Agregar pieza' }),
      el('p', { className: 'page-sub', text: 'Toma la foto, recorta la figura y rellenamos el nombre.' })
    ]),
    el('form', { id: 'add-form', className: 'stack-form' }, [
      el('div', { className: 'photo-capture-block' }, [
        el('div', { className: 'preview-frame', id: 'preview' }, [
          el('span', { className: 'muted', text: 'Sin fotografía aún' })
        ]),
        el('div', { className: 'btn-row' }, [
          el('label', { className: 'btn btn-primary', html: '📷 Tomar foto<input type="file" accept="image/*" capture="environment" id="cam" hidden>' }),
          el('label', { className: 'btn btn-ghost', html: 'Galería<input type="file" accept="image/*" id="gallery" hidden>' }),
          el('button', {
            type: 'button',
            className: 'btn btn-ghost hidden',
            id: 'clear-photo',
            text: 'Quitar foto'
          })
        ])
      ]),
      el('p', { className: 'status-line muted', id: 'id-status', text: 'La foto se analiza al instante (OCR de caja; IA opcional).' }),
      el('label', {}, [
        el('span', { text: 'Nombre *' }),
        el('input', { className: 'input', name: 'name', required: true, placeholder: 'Se rellena al tomar la foto…', autocomplete: 'off' })
      ]),
      el('label', {}, [
        el('span', { text: 'Categoría' }),
        el('select', { className: 'input', name: 'collection_id' }, [
          el('option', { value: '', text: 'Sin categoría' }),
          ...collections.map((c) => el('option', { value: c.id, text: c.name }))
        ])
      ]),
      el('details', { className: 'more-fields', id: 'more-fields' }, [
        el('summary', { text: 'Más detalles (opcional)' }),
        ...['manufacturer', 'franchise', 'series', 'item_number', 'character_name', 'category'].map((name) =>
          el('label', {}, [
            el('span', { text: labelFor(name) }),
            el('input', { className: 'input', name, autocomplete: 'off' })
          ])
        ),
        el('label', {}, [
          el('span', { text: 'Año' }),
          el('input', { className: 'input', name: 'year', type: 'number', inputmode: 'numeric' })
        ]),
        el('label', {}, [
          el('span', { text: 'Cantidad' }),
          el('input', { className: 'input', name: 'quantity', type: 'number', value: '1', min: '1' })
        ]),
        el('label', {}, [
          el('span', { text: 'Precio de compra' }),
          el('input', { className: 'input', name: 'purchase_price', type: 'number', step: '0.01' })
        ]),
        el('label', {}, [
          el('span', { text: 'Estado' }),
          el('select', { className: 'input', name: 'condition' }, [
            el('option', { value: '', text: '—' }),
            ...['Nuevo', 'Como nuevo', 'Bueno', 'Aceptable', 'Caja dañada'].map((t) => el('option', { value: t, text: t }))
          ])
        ]),
        el('label', {}, [
          el('span', { text: 'Notas' }),
          el('textarea', { className: 'input', name: 'notes', rows: 3 })
        ])
      ]),
      el('p', { className: 'status-line muted', id: 'add-status' }),
      el('button', { type: 'submit', className: 'btn btn-primary btn-block', text: 'Guardar pieza' })
    ])
  ]));

  let photoFile = null;
  let photoObjectUrl = null;
  let identifySeq = 0;
  const preview = root.querySelector('#preview');
  const form = root.querySelector('#add-form');
  const idStatus = root.querySelector('#id-status');
  const clearPhotoBtn = root.querySelector('#clear-photo');
  const camInput = root.querySelector('#cam');
  const galleryInput = root.querySelector('#gallery');

  const clearPhoto = ({ resetStatus = true } = {}) => {
    identifySeq += 1;
    photoFile = null;
    if (photoObjectUrl) {
      try { URL.revokeObjectURL(photoObjectUrl); } catch { /* ignore */ }
      photoObjectUrl = null;
    }
    if (camInput) camInput.value = '';
    if (galleryInput) galleryInput.value = '';
    window.__pendingIdentifyFile = null;
    preview.innerHTML = '';
    preview.append(el('span', { className: 'muted', text: 'Sin fotografía aún' }));
    clearPhotoBtn?.classList.add('hidden');
    if (resetStatus && idStatus) {
      idStatus.textContent = 'La foto se analiza al instante (OCR de caja; IA opcional).';
    }
  };

  const applySuggestion = (s) => {
    if (!s) return;
    const setIfEmpty = (name, value) => {
      if (value == null || value === '') return;
      const input = form.elements.namedItem(name);
      if (!input) return;
      if (!String(input.value || '').trim()) input.value = String(value);
    };
    if (s.name) {
      const nameInput = form.elements.namedItem('name');
      if (nameInput && !String(nameInput.value || '').trim()) nameInput.value = s.name;
      else if (nameInput && s.confidence === 'high') nameInput.value = s.name;
    }
    setIfEmpty('manufacturer', s.manufacturer);
    setIfEmpty('franchise', s.franchise);
    setIfEmpty('series', s.series);
    setIfEmpty('item_number', s.item_number);
    setIfEmpty('character_name', s.character_name);
    setIfEmpty('category', s.category);
    setIfEmpty('year', s.year);
    if (s.manufacturer || s.series || s.item_number || s.franchise) {
      root.querySelector('#more-fields')?.setAttribute('open', '');
    }
  };

  const setPhoto = async (file) => {
    if (!file) return;
    let prepared;
    try {
      prepared = await prepareImageForAnalysis(file, { cropTitle: 'Recortar figura' });
      if (!prepared) return;
    } catch (err) {
      toast(err.message, 'error');
      return;
    }

    if (photoObjectUrl) {
      try { URL.revokeObjectURL(photoObjectUrl); } catch { /* ignore */ }
      photoObjectUrl = null;
    }

    photoFile = prepared;
    photoObjectUrl = URL.createObjectURL(photoFile);
    preview.innerHTML = '';
    const img = el('img', { alt: 'Vista previa' });
    img.src = photoObjectUrl;
    preview.append(img);
    clearPhotoBtn?.classList.remove('hidden');

    const seq = ++identifySeq;
    idStatus.textContent = 'Analizando foto…';
    try {
      const suggestion = await identifyFigureFromPhoto(photoFile, {
        onProgress: (p) => {
          if (seq !== identifySeq) return;
          idStatus.textContent = p.message || p.stage;
        }
      });
      if (seq !== identifySeq) return;
      applySuggestion(suggestion);
      if (suggestion.name) {
        idStatus.textContent = suggestion.source === 'gemini'
          ? `Detectado (IA): ${suggestion.name}`
          : `Texto leído: ${suggestion.name}${suggestion.manufacturer ? ` · ${suggestion.manufacturer}` : ''}`;
        toast('Campos rellenados desde la foto — revisa y guarda', 'ok');
      } else {
        idStatus.textContent = suggestion.note
          || 'No se pudo leer el nombre. Escribe uno o usa foto de la caja.';
      }
    } catch (err) {
      if (seq !== identifySeq) return;
      idStatus.textContent = err.message || 'No se pudo analizar la foto';
    }
  };

  camInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setPhoto(f);
  });
  galleryInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setPhoto(f);
  });
  clearPhotoBtn?.addEventListener('click', () => {
    clearPhoto();
    toast('Foto quitada', 'ok');
  });

  if (prefillPhoto) {
    window.__pendingIdentifyFile = null;
    await setPhoto(prefillPhoto);
  }

  root.querySelector('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('[type=submit]');
    const status = root.querySelector('#add-status');
    setBusy(btn, true, 'Guardando…');
    try {
      status.textContent = 'Creando pieza…';
      const item = await createItem({
        name: fd.get('name'),
        collection_id: fd.get('collection_id') || null,
        manufacturer: fd.get('manufacturer'),
        franchise: fd.get('franchise'),
        series: fd.get('series'),
        item_number: fd.get('item_number'),
        character_name: fd.get('character_name'),
        category: fd.get('category'),
        year: fd.get('year'),
        quantity: fd.get('quantity') || 1,
        purchase_price: fd.get('purchase_price'),
        condition: fd.get('condition'),
        notes: fd.get('notes')
      });

      if (photoFile) {
        status.textContent = 'Subiendo foto y generando embedding…';
        await uploadItemImage(item.id, photoFile, 'frontal', (p) => {
          status.textContent = p.message || p.stage;
        });
      }

      toast('Pieza guardada', 'ok');
      navigate(`item/${item.id}`, true);
    } catch (err) {
      toast(err.message || 'Error al guardar', 'error');
      status.textContent = '';
    } finally {
      setBusy(btn, false);
    }
  });
}

function labelFor(name) {
  return ({
    manufacturer: 'Marca / fabricante',
    franchise: 'Franquicia',
    series: 'Serie',
    item_number: 'Número',
    character: 'Personaje',
    character_name: 'Personaje',
    category: 'Categoría'
  })[name] || name;
}

export async function renderItemDetail(root, params) {
  const id = params[0];
  if (!id) {
    root.append(el('p', { text: 'Pieza no encontrada' }));
    return;
  }

  const item = await getItem(id);
  const paths = (item.item_images || []).map((i) => i.storage_path);
  // URL firmada larga para que Google Lens pueda leer la foto
  const urls = await getSignedUrls(paths, 60 * 60 * 12);

  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('a', { href: '#/collection', className: 'back-link', text: '← Colección' }),
      el('h1', { text: item.name }),
      el('p', { className: 'page-sub', text: [item.collections?.name, item.manufacturer, item.franchise].filter(Boolean).join(' · ') })
    ]),
    el('div', { className: 'detail-gallery', id: 'gallery' }),
    el('div', { className: 'detail-meta' }, [
      el('div', { className: 'meta-chip', text: `Cantidad: ${item.quantity}` }),
      item.item_number ? el('div', { className: 'meta-chip', text: `#${item.item_number}` }) : null,
      item.year ? el('div', { className: 'meta-chip', text: String(item.year) }) : null,
      item.condition ? el('div', { className: 'meta-chip', text: item.condition }) : null,
      item.purchase_price != null ? el('div', { className: 'meta-chip', text: formatMoney(item.purchase_price, item.currency) }) : null
    ]),
    item.notes ? el('p', { className: 'notes-block', text: item.notes }) : null,
    el('section', { className: 'market-panel', id: 'market-panel' }, [
      el('div', { className: 'market-panel-head' }, [
        el('h2', { text: 'Precio de mercado' }),
        el('p', { className: 'page-sub', text: 'Caché local · ganancia vs lo que pagaste' })
      ]),
      el('div', { className: 'market-toolbar' }, [
        el('div', { id: 'market-status', className: 'status-line muted', text: '…' }),
        el('button', {
          type: 'button',
          className: 'btn btn-ghost hidden',
          id: 'market-cancel',
          text: 'Detener'
        }),
        el('button', {
          type: 'button',
          className: 'btn btn-ghost',
          id: 'market-refresh',
          text: 'Buscar de nuevo'
        })
      ]),
      el('div', { id: 'market-profit', className: 'market-profit hidden' }),
      el('div', { id: 'market-body', className: 'market-body' }),
      el('div', { className: 'market-actions', id: 'market-actions' })
    ]),
    el('div', { className: 'btn-stack' }, [
      el('a', { href: `#/edit/${item.id}`, className: 'btn btn-primary btn-block', text: 'Editar' }),
      el('button', { type: 'button', className: 'btn btn-ghost btn-block', id: 'add-unit', text: '+ Agregar otra unidad' }),
      el('button', { type: 'button', className: 'btn btn-danger btn-block', id: 'delete-item', text: 'Eliminar pieza' })
    ])
  ]));

  const marketBody = root.querySelector('#market-body');
  const marketActions = root.querySelector('#market-actions');
  const marketStatus = root.querySelector('#market-status');
  const marketProfit = root.querySelector('#market-profit');
  const marketRefreshBtn = root.querySelector('#market-refresh');
  const marketCancelBtn = root.querySelector('#market-cancel');
  let marketAbort = null;
  const preferTypes = ['frontal', 'caja', 'etiqueta', 'codigo'];
  const sortedImgs = [...(item.item_images || [])].sort((a, b) => {
    const ia = preferTypes.indexOf(a.image_type);
    const ib = preferTypes.indexOf(b.image_type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const photoPath = sortedImgs[0]?.storage_path;
  const imageUrl = photoPath ? (urls[photoPath] || null) : null;

  /** @type {object|null} */
  let lastMarketResult = null;

  const paintProfit = () => {
    if (!marketProfit) return;
    const deal = classifyDeal(item.purchase_price, item.market_price_median);
    if (deal.code === 'unknown_purchase' || deal.code === 'unknown_market') {
      marketProfit.className = 'market-profit muted';
      marketProfit.textContent = deal.detail;
      return;
    }
    const gain = deal.profit != null && deal.profit > 0;
    const loss = deal.profit != null && deal.profit < 0;
    marketProfit.className = `market-profit ${gain ? 'is-gain' : loss ? 'is-loss' : 'is-even'}`;
    marketProfit.innerHTML = '';
    marketProfit.append(
      el('strong', { text: deal.label }),
      el('p', { text: deal.detail })
    );
  };

  const applyChosenMatch = async (match, allMatches, btn = null) => {
    try {
      setBusy(btn, true, 'Guardando…');
      if (marketStatus) marketStatus.textContent = 'Guardando precio…';
      const prices = (allMatches || []).map((m) => Number(m.price)).filter((n) => Number.isFinite(n) && n > 0);
      const saved = await saveManualMarketPrice(item, match.price, {
        low: prices.length ? Math.min(...prices) : match.price,
        high: prices.length ? Math.max(...prices) : match.price,
        sampleSize: Math.max(1, prices.length),
        query: match.title || match.query || item.name,
        currency: match.currency || 'USD',
        chosenId: match.id
      });
      item.market_price_median = saved.median;
      item.market_price_low = saved.low;
      item.market_price_high = saved.high;
      item.market_currency = saved.currency;
      item.market_source = match.source || 'auto';
      item.market_checked_at = saved.checkedAt;
      item.market_sample_size = saved.sampleSize;
      item.market_query = saved.query;
      const deal = classifyDeal(item.purchase_price, saved.median);
      const next = {
        ...(lastMarketResult || buildInstantMarket(item, { imageUrl })),
        median: saved.median,
        low: saved.low,
        high: saved.high,
        chosenId: match.id,
        deal,
        fromCache: true
      };
      saveMarketCache(item.id, { ...next, matches: allMatches || next.matches || [] });
      refreshMarket(next);
      paintProfit();
      if (marketStatus) marketStatus.textContent = 'Precio ideal guardado (en caché)';
      if (deal.profit != null && item.purchase_price != null) {
        toast(deal.label, deal.profit >= 0 ? 'ok' : 'error');
      } else {
        toast('Precio ideal guardado', 'ok');
      }
    } catch (err) {
      toast(err.message, 'error');
      if (marketStatus) marketStatus.textContent = err.message || 'No se pudo guardar';
    } finally {
      setBusy(btn, false);
    }
  };

  const refreshMarket = (result) => {
    lastMarketResult = result;
    paintMarketResult(marketBody, result, item, {
      onChooseMatch: applyChosenMatch,
      onAddCandidatePrice: (preset) => {
        addMarketCandidate(item.id, preset);
        paintMarketCandidates(marketActions, item, imageUrl, () => refreshMarket(lastMarketResult || buildInstantMarket(item, { imageUrl })));
      }
    });
    paintMarketCandidates(marketActions, item, imageUrl, () => refreshMarket(lastMarketResult || buildInstantMarket(item, { imageUrl })));
    paintProfit();
  };

  const runMarketSearch = (force = false) => {
    if (!force) {
      const cached = getCachedMarketView(item, { imageUrl });
      if (cached) {
        refreshMarket(cached);
        marketStatus.textContent = cached.fromCache
          ? 'Mostrando búsqueda guardada'
          : 'Mostrando precio guardado';
        return;
      }
    } else {
      clearMarketCache(item.id);
    }

    if (marketAbort) {
      try { marketAbort.abort(); } catch { /* ignore */ }
    }
    marketAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (marketCancelBtn) marketCancelBtn.classList.remove('hidden');

    marketStatus.textContent = 'Buscando precios automáticamente (reintenta hasta obtener precio)…';
    refreshMarket(buildInstantMarket(item, { imageUrl }));
    lookupMarketPrice(item, {
      imageUrl,
      signal: marketAbort?.signal,
      onProgress: (p) => {
        if (marketStatus) marketStatus.textContent = p.message || p.stage || 'Buscando…';
      }
    }).then((result) => {
      if (marketCancelBtn) marketCancelBtn.classList.add('hidden');
      refreshMarket(result);
      paintProfit();
      if (result.status === 'found') {
        marketStatus.textContent = result.matches?.length > 1
          ? `Encontré ${result.matches.length} coincidencias — elige la ideal`
          : 'Encontré 1 coincidencia';
      } else if (result.status === 'empty') {
        marketStatus.textContent = 'Sin coincidencias automáticas tras reintentos';
      } else {
        marketStatus.textContent = result.note || 'No se pudo completar la búsqueda automática';
      }
    }).catch((err) => {
      if (marketCancelBtn) marketCancelBtn.classList.add('hidden');
      if (err?.name === 'AbortError') {
        marketStatus.textContent = 'Búsqueda detenida';
        return;
      }
      marketStatus.textContent = err.message || 'Error al buscar precio';
    });
  };

  marketCancelBtn?.addEventListener('click', () => {
    try { marketAbort?.abort(); } catch { /* ignore */ }
    if (marketCancelBtn) marketCancelBtn.classList.add('hidden');
    if (marketStatus) marketStatus.textContent = 'Deteniendo…';
  });

  marketRefreshBtn?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Buscando…');
    runMarketSearch(true);
    setTimeout(() => setBusy(btn, false), 800);
  });

  runMarketSearch(false);

  const gallery = root.querySelector('#gallery');
  if (!item.item_images?.length) {
    gallery.append(el('div', { className: 'photo-placeholder tall', text: 'Sin fotografías' }));
  } else {
    for (const img of item.item_images) {
      gallery.append(
        el('figure', { className: 'gallery-item' }, [
          el('img', { src: urls[img.storage_path] || '', alt: imageTypeLabel(img.image_type), loading: 'lazy' }),
          el('figcaption', { text: imageTypeLabel(img.image_type) })
        ])
      );
    }
  }

  root.querySelector('#add-unit').addEventListener('click', async () => {
    try {
      await incrementQuantity(item.id, 1);
      toast('Cantidad actualizada', 'ok');
      navigate(`item/${item.id}`, true);
      location.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector('#delete-item').addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta pieza y sus fotografías?')) return;
    try {
      await deleteItem(item.id);
      toast('Pieza eliminada', 'ok');
      navigate('collection', true);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export async function renderEdit(root, params) {
  const id = params[0];
  const [item, collections] = await Promise.all([getItem(id), listCollections()]);
  const urls = await getSignedUrls((item.item_images || []).map((i) => i.storage_path));

  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('a', { href: `#/item/${id}`, className: 'back-link', text: '← Volver' }),
      el('h1', { text: 'Editar pieza' })
    ]),
    el('form', { id: 'edit-form', className: 'stack-form' }, [
      el('label', {}, [el('span', { text: 'Nombre' }), el('input', { className: 'input', name: 'name', value: item.name, required: true })]),
      el('label', {}, [
        el('span', { text: 'Categoría' }),
        el('select', { className: 'input', name: 'collection_id' }, [
          el('option', { value: '', text: 'Sin categoría' }),
          ...collections.map((c) => el('option', { value: c.id, text: c.name, ...(c.id === item.collection_id ? { selected: true } : {}) }))
        ])
      ]),
      ...['manufacturer', 'franchise', 'series', 'item_number', 'character_name', 'category'].map((name) =>
        el('label', {}, [
          el('span', { text: labelFor(name) }),
          el('input', { className: 'input', name, value: item[name] || '' })
        ])
      ),
      el('label', {}, [el('span', { text: 'Año' }), el('input', { className: 'input', name: 'year', type: 'number', value: item.year ?? '' })]),
      el('label', {}, [el('span', { text: 'Cantidad' }), el('input', { className: 'input', name: 'quantity', type: 'number', min: '0', value: item.quantity ?? 1 })]),
      el('label', {}, [el('span', { text: 'Precio' }), el('input', { className: 'input', name: 'purchase_price', type: 'number', step: '0.01', value: item.purchase_price ?? '' })]),
      el('label', {}, [
        el('span', { text: 'Estado' }),
        el('select', { className: 'input', name: 'condition' }, [
          el('option', { value: '', text: '—' }),
          ...['Nuevo', 'Como nuevo', 'Bueno', 'Aceptable', 'Caja dañada'].map((t) =>
            el('option', { value: t, text: t, ...(item.condition === t ? { selected: true } : {}) })
          )
        ])
      ]),
      el('label', {}, [el('span', { text: 'Notas' }), el('textarea', { className: 'input', name: 'notes', rows: 3, text: item.notes || '' })]),
      el('button', { type: 'submit', className: 'btn btn-primary btn-block', text: 'Guardar cambios' })
    ]),
    el('section', { className: 'section' }, [
      el('h2', { text: 'Fotografías' }),
      el('div', { className: 'edit-photos', id: 'edit-photos' }),
      el('div', { className: 'btn-row wrap' }, [
        el('select', { id: 'img-type', className: 'input grow' }, [
          ...['frontal', 'trasera', 'lateral', 'caja', 'codigo', 'etiqueta', 'additional'].map((t) =>
            el('option', { value: t, text: imageTypeLabel(t) })
          )
        ]),
        el('label', { className: 'btn btn-ghost', html: '+ Foto<input type="file" accept="image/*" capture="environment" id="add-photo" hidden>' })
      ]),
      el('p', { className: 'status-line muted', id: 'photo-status' })
    ])
  ]));

  const photosHost = root.querySelector('#edit-photos');
  for (const img of item.item_images || []) {
    const fig = el('div', { className: 'edit-photo-row' }, [
      el('img', { src: urls[img.storage_path] || '', alt: '' }),
      el('div', {}, [
        el('strong', { text: imageTypeLabel(img.image_type) }),
        el('button', { type: 'button', className: 'btn btn-danger btn-sm', text: 'Eliminar', dataset: { id: img.id } })
      ])
    ]);
    fig.querySelector('button').addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta fotografía y su embedding?')) return;
      try {
        await deleteImageRecord(img);
        toast('Foto eliminada', 'ok');
        navigate(`edit/${id}`, true);
        location.hash = `#/edit/${id}`;
        location.reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    photosHost.append(fig);
  }

  root.querySelector('#add-photo').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const status = root.querySelector('#photo-status');
    try {
      const prepared = await prepareImageForAnalysis(file, { cropTitle: 'Recortar fotografía' });
      if (!prepared) return;
      status.textContent = 'Procesando…';
      await uploadItemImage(id, prepared, root.querySelector('#img-type').value, (p) => {
        status.textContent = p.message || p.stage;
      });
      toast('Fotografía agregada', 'ok');
      location.reload();
    } catch (err) {
      toast(err.message, 'error');
      status.textContent = '';
    }
  });

  root.querySelector('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('[type=submit]');
    setBusy(btn, true);
    try {
      const payload = Object.fromEntries(fd.entries());
      await updateItem(id, payload);
      const paid = payload.purchase_price !== '' && payload.purchase_price != null
        ? Number(payload.purchase_price)
        : null;
      if (paid != null && item.market_price_median != null) {
        const deal = classifyDeal(paid, item.market_price_median);
        toast(deal.label, deal.profit != null && deal.profit < 0 ? 'error' : 'ok');
      } else {
        toast('Guardado', 'ok');
      }
      navigate(`item/${id}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });
}

export async function renderDuplicates(root) {
  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Duplicados' }),
      el('p', { className: 'page-sub', text: 'Piezas con cantidad mayor que 1 (no son registros separados).' })
    ]),
    el('div', { className: 'card-grid', id: 'dup-grid' })
  ]));

  const items = await getDuplicateItems();
  const withThumbs = await enrichItemsWithThumbs(items);
  const grid = root.querySelector('#dup-grid');
  if (!withThumbs.length) {
    grid.append(emptyState('No hay duplicados', 'Cuando tengas quantity > 1 aparecerán aquí.'));
    return;
  }
  for (const item of withThumbs) grid.append(itemCard(item));
}

/**
 * @param {HTMLElement} host
 * @param {object} result
 * @param {object} item
 * @param {{ onAddCandidatePrice?: Function, onChooseMatch?: Function }} [hooks]
 */
function paintMarketResult(host, result, item, hooks = {}) {
  if (!host) return;
  host.innerHTML = '';
  const currency = result.currency || 'USD';
  const deal = result.deal || {};
  const matches = Array.isArray(result.matches) ? result.matches : [];

  // —— Coincidencias automáticas (principal) ——
  const tcg = Boolean(result.tcg) || isTcgCardItem(item);
  host.append(el('p', {
    className: 'market-step',
    text: tcg ? 'Coincidencias (referencia: TCGPlayer Market Price)' : 'Coincidencias encontradas'
  }));

  if (result.auto && result.status === 'found' && matches.length) {
    const list = el('div', { className: 'market-match-list' });
    for (const match of matches) {
      const isMarketRef = isTcgMarketPriceMatch(match) || result.referenceMatchId === match.id;
      const chosen = result.chosenId === match.id
        || (item.market_price_median != null && Number(item.market_price_median) === Number(match.price) && matches.length === 1);
      const link = listingLinkMeta(match);
      const href = link.url;
      const row = el('article', {
        className: `market-match-card is-store-link${chosen ? ' is-chosen' : ''}${isMarketRef ? ' is-market-ref' : ''}${link.exact ? '' : ' is-search-link'}`
      }, [
        el('div', { className: 'market-match-main' }, [
          el('strong', { className: 'market-match-price', text: formatMoneyDual(match.price, match.currency || currency) }),
          isMarketRef
            ? el('span', { className: 'market-ref-badge', text: 'Market Price' })
            : null,
          !link.exact ? el('span', { className: 'market-ref-badge market-est-badge', text: 'Orientativo' }) : null,
          el('p', { className: 'market-match-title', text: match.title || 'Sin título' }),
          el('p', {
            className: 'muted small',
            text: [match.source, match.priceType, match.note].filter(Boolean).join(' · ')
          }),
          el('span', { className: 'market-match-open', text: link.label })
        ]),
        hooks.onChooseMatch
          ? el('div', { className: 'market-match-actions' }, [
            el('button', {
              type: 'button',
              className: chosen ? 'btn btn-primary' : 'btn btn-ghost',
              text: chosen ? '✓ Ideal' : (isMarketRef ? 'Usar Market Price' : (matches.length > 1 ? 'Usar este' : 'Guardar')),
              onClick: (e) => {
                e.stopPropagation();
                hooks.onChooseMatch(match, matches, e.currentTarget);
              }
            })
          ])
          : null
      ]);
      row.addEventListener('click', () => openExternal(href));
      list.append(row);
    }
    host.append(list);
    if (matches.length > 1) {
      host.append(el('p', {
        className: 'muted small',
        text: tcg
          ? 'Para cartas, la referencia es el Market Price de TCGPlayer. Elige esa si aparece.'
          : 'Hay varias similitudes. Elige la que corresponda a TU figura.'
      }));
    }
  } else if (result.auto && result.status === 'empty') {
    host.append(el('div', { className: 'notice notice-warn' }, [
      el('p', { text: 'No encontré coincidencias automáticas con precio.' }),
      el('p', { className: 'muted small', text: result.note || 'Prueba mejorando marca/serie/personaje o usa un buscador abajo.' })
    ]));
  } else if (result.auto && result.status === 'error') {
    host.append(el('div', { className: 'notice notice-warn' }, [
      el('p', { text: 'La búsqueda automática no pudo leer el mercado ahora.' }),
      el('p', { className: 'muted small', text: result.note || '' })
    ]));
  } else if (!result.auto) {
    host.append(el('p', { className: 'muted small', text: 'Preparando búsqueda automática…' }));
  }

  if (result.median != null || item?.purchase_price != null) {
    const tcgRef = Boolean(result.tcg) || isTcgCardItem(item);
    host.append(el('div', { className: 'market-stats' }, [
      result.median != null
        ? el('div', { className: 'market-stat main' }, [
          el('span', { className: 'market-stat-label', text: tcgRef ? 'Market Price' : 'Tu estimado' }),
          el('strong', { text: formatMoneyDual(result.median, currency) })
        ])
        : el('div', { className: 'market-stat main' }, [
          el('span', { className: 'market-stat-label', text: tcgRef ? 'Market Price' : 'Tu estimado' }),
          el('strong', { text: '—' })
        ]),
      item?.purchase_price != null
        ? el('div', { className: 'market-stat' }, [
          el('span', { className: 'market-stat-label', text: 'Pagaste' }),
          el('strong', { text: formatMoneyDual(item.purchase_price, item.currency || currency) })
        ])
        : null
    ]));

    host.append(el('div', {
      className: `market-deal deal-${deal.code || 'unknown'}`
    }, [
      el('strong', { text: deal.label || 'Sin veredicto' }),
      el('p', { text: deal.detail || 'Elige una coincidencia o anota un precio.' })
    ]));
  }

  // —— Fallback manual (secundario, colapsado) ——
  const details = el('details', { className: 'market-fallback' }, [
    el('summary', { text: 'Abrir buscadores manualmente (opcional)' })
  ]);

  const visual = result.visualLinks?.length
    ? result.visualLinks
    : (result.links || []).filter((l) => l.kind === 'visual' || l.region === 'VIS');

  if (visual.length) {
    const box = el('div', { className: 'market-primary' });
    for (const link of visual) {
      box.append(el('a', {
        className: 'btn btn-ghost btn-block',
        href: link.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: link.label
      }));
    }
    details.append(box);
  }

  const groups = result.queryGroups?.length
    ? result.queryGroups
    : (result.query ? [{ query: result.query, links: (result.links || []).filter((l) => l.kind !== 'visual') }] : []);

  for (const group of groups) {
    details.append(el('div', { className: 'market-query-group' }, [
      el('p', { className: 'market-query-label', text: `“${group.query}”` }),
      el('div', { className: 'market-query-links' },
        (group.links || []).map((link) =>
          el('a', {
            className: 'market-chip',
            href: link.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: link.label
          })
        )
      )
    ]));
  }
  host.append(details);

  if (result.note && result.auto) {
    host.append(el('p', { className: 'muted small', text: result.note }));
  }
}

/** @type {Record<string, Array<{ id: string, price: number, label: string, chosen?: boolean }>>} */
window.__marketPriceCandidates = window.__marketPriceCandidates || {};

function getMarketCandidates(itemId) {
  if (!window.__marketPriceCandidates[itemId]) window.__marketPriceCandidates[itemId] = [];
  return window.__marketPriceCandidates[itemId];
}

function addMarketCandidate(itemId, preset = {}) {
  const list = getMarketCandidates(itemId);
  const price = Number(preset.price);
  const label = String(preset.label || '').trim() || `Parecida #${list.length + 1}`;
  if (Number.isFinite(price) && price > 0) {
    list.push({
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      price,
      label
    });
    return;
  }
  // Sin precio aún: marcar preset para el formulario
  window.__marketCandidateDraft = {
    itemId,
    label,
    price: preset.price != null ? String(preset.price) : ''
  };
}

/**
 * Paso 3: anotar varias similitudes y elegir la ideal en precio.
 * @param {HTMLElement} host
 * @param {object} item
 * @param {string|null} imageUrl
 * @param {() => void} refreshMarket
 */
function paintMarketCandidates(host, item, imageUrl, refreshMarket) {
  if (!host) return;
  host.innerHTML = '';
  const candidates = getMarketCandidates(item.id);
  const draft = window.__marketCandidateDraft?.itemId === item.id
    ? window.__marketCandidateDraft
    : { label: '', price: '' };

  host.append(el('p', { className: 'market-step', text: 'Paso 3 — si hay varias parecidas, elige la ideal' }));
  host.append(el('p', {
    className: 'muted small',
    text: 'Anota el precio de cada figura similar que viste. Luego toca “Usar este” en la que sí corresponde.'
  }));

  const form = el('div', { className: 'market-candidate-form' }, [
    el('input', {
      className: 'input',
      id: 'market-cand-label',
      type: 'text',
      placeholder: 'Qué viste (ej. Nendoroid Link BOTW)',
      value: draft.label || ''
    }),
    el('div', { className: 'market-manual-row' }, [
      el('input', {
        className: 'input',
        id: 'market-cand-price',
        type: 'number',
        step: '0.01',
        min: '0',
        placeholder: 'Precio USD',
        value: draft.price || ''
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-ghost',
        id: 'market-cand-add',
        text: 'Añadir'
      })
    ])
  ]);
  host.append(form);

  const addBtn = form.querySelector('#market-cand-add');
  const priceInput = form.querySelector('#market-cand-price');
  const labelInput = form.querySelector('#market-cand-label');

  const doAdd = () => {
    const price = Number(priceInput.value);
    const label = String(labelInput.value || '').trim();
    if (!Number.isFinite(price) || price <= 0) {
      toast('Escribe un precio válido', 'error');
      return;
    }
    candidates.push({
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      price,
      label: label || `Parecida #${candidates.length + 1}`
    });
    window.__marketCandidateDraft = null;
    priceInput.value = '';
    paintMarketCandidates(host, item, imageUrl, refreshMarket);
    toast('Candidato añadido', 'ok');
  };

  addBtn.addEventListener('click', doAdd);
  priceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doAdd();
    }
  });
  if (draft.label || draft.price !== undefined && window.__marketCandidateDraft?.itemId === item.id) {
    priceInput.focus();
  }

  if (!candidates.length) {
    host.append(el('p', {
      className: 'muted small',
      text: item.market_price_median != null
        ? `Estimado actual: ${formatMoneyDual(item.market_price_median, item.market_currency || 'USD')}. Puedes añadir más opciones y cambiar la ideal.`
        : 'Todavía no hay candidatos. Abre Lens/eBay, anota 2–3 precios parecidos y elige.'
    }));
    return;
  }

  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const list = el('div', { className: 'market-candidate-list' });

  for (const cand of sorted) {
    const isChosen = Boolean(cand.chosen);
    const card = el('article', {
      className: `market-candidate-card${isChosen ? ' is-chosen' : ''}`
    }, [
      el('div', { className: 'market-candidate-main' }, [
        el('strong', { className: 'market-candidate-price', text: formatMoneyDual(cand.price, 'USD') }),
        el('p', { className: 'market-candidate-label', text: cand.label }),
        isChosen ? el('span', { className: 'market-candidate-badge', text: 'Ideal (guardada)' }) : null
      ]),
      el('div', { className: 'market-candidate-actions' }, [
        el('button', {
          type: 'button',
          className: isChosen ? 'btn btn-primary' : 'btn btn-ghost',
          text: isChosen ? '✓ Ideal' : 'Usar este',
          onClick: async (e) => {
            const btn = e.currentTarget;
            try {
              setBusy(btn, true, 'Guardando…');
              const prices = candidates.map((c) => c.price);
              const saved = await saveManualMarketPrice(item, cand.price, {
                low: Math.min(...prices),
                high: Math.max(...prices),
                sampleSize: candidates.length,
                query: cand.label,
                currency: 'USD'
              });
              for (const c of candidates) c.chosen = c.id === cand.id;
              item.market_price_median = saved.median;
              item.market_price_low = saved.low;
              item.market_price_high = saved.high;
              item.market_currency = saved.currency;
              item.market_source = 'manual';
              item.market_checked_at = saved.checkedAt;
              item.market_sample_size = saved.sampleSize;
              item.market_query = saved.query;
              refreshMarket();
              toast('Precio ideal guardado', 'ok');
            } catch (err) {
              toast(err.message, 'error');
            } finally {
              setBusy(btn, false);
            }
          }
        }),
        el('button', {
          type: 'button',
          className: 'btn btn-ghost market-candidate-remove',
          text: '✕',
          'aria-label': 'Quitar',
          onClick: () => {
            const idx = candidates.findIndex((c) => c.id === cand.id);
            if (idx >= 0) candidates.splice(idx, 1);
            paintMarketCandidates(host, item, imageUrl, refreshMarket);
          }
        })
      ])
    ]);
    list.append(card);
  }

  host.append(list);

  if (candidates.length >= 2) {
    const prices = sorted.map((c) => c.price);
    const mid = prices[Math.floor(prices.length / 2)];
    host.append(el('p', {
      className: 'muted small',
      text: `${candidates.length} opciones · de ${formatMoneyDual(prices[0], 'USD')} a ${formatMoneyDual(prices[prices.length - 1], 'USD')} · mediana ~${formatMoneyDual(mid, 'USD')}. Elige la que sí sea tu figura.`
    }));
  }
}
