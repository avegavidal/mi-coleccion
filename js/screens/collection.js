import { el, emptyState, toast, setBusy, compressImage, imageTypeLabel, formatMoney, formatDate } from '../utils/dom.js';
import { itemCard } from './dashboard.js';
import {
  listItems, listCollections, createItem, getItem, updateItem,
  deleteItem, incrementQuantity, getDuplicateItems
} from '../services/collectionService.js';
import { enrichItemsWithThumbs } from '../services/exportService.js';
import { uploadItemImage, deleteImageRecord, getSignedUrl, getSignedUrls } from '../services/imageService.js';
import {
  buildInstantMarket,
  saveManualMarketPrice
} from '../services/marketPriceService.js';
import { identifyFigureFromPhoto } from '../services/visionIdentifyService.js';
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
      el('p', { className: 'page-sub', text: 'Toma la foto: intentamos rellenar el nombre solos.' })
    ]),
    el('form', { id: 'add-form', className: 'stack-form' }, [
      el('div', { className: 'photo-capture-block' }, [
        el('div', { className: 'preview-frame', id: 'preview' }, [
          el('span', { className: 'muted', text: 'Sin fotografía aún' })
        ]),
        el('div', { className: 'btn-row' }, [
          el('label', { className: 'btn btn-primary', html: '📷 Tomar foto<input type="file" accept="image/*" capture="environment" id="cam" hidden>' }),
          el('label', { className: 'btn btn-ghost', html: 'Galería<input type="file" accept="image/*" id="gallery" hidden>' })
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
  let identifySeq = 0;
  const preview = root.querySelector('#preview');
  const form = root.querySelector('#add-form');
  const idStatus = root.querySelector('#id-status');

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
    photoFile = await compressImage(file);
    preview.innerHTML = '';
    const img = el('img', { alt: 'Vista previa' });
    img.src = URL.createObjectURL(photoFile);
    preview.append(img);

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

  root.querySelector('#cam').addEventListener('change', (e) => setPhoto(e.target.files?.[0]));
  root.querySelector('#gallery').addEventListener('change', (e) => setPhoto(e.target.files?.[0]));

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
  const urls = await getSignedUrls(paths);

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
        el('p', { className: 'page-sub', text: 'Foto / Lens · Amazon US/JP · eBay · Japón' })
      ]),
      el('div', { id: 'market-body', className: 'market-body' }),
      el('div', { className: 'market-actions' }, [
        el('label', { className: 'market-manual' }, [
          el('span', { text: 'Guarda la mediana que viste (USD)' }),
          el('div', { className: 'market-manual-row' }, [
            el('input', {
              className: 'input',
              id: 'market-manual-price',
              type: 'number',
              step: '0.01',
              min: '0',
              placeholder: 'Ej. 45.00',
              value: item.market_price_median ?? ''
            }),
            el('button', { type: 'button', className: 'btn btn-ghost', id: 'market-save-manual', text: 'Guardar' })
          ])
        ])
      ])
    ]),
    el('div', { className: 'btn-stack' }, [
      el('a', { href: `#/edit/${item.id}`, className: 'btn btn-primary btn-block', text: 'Editar' }),
      el('button', { type: 'button', className: 'btn btn-ghost btn-block', id: 'add-unit', text: '+ Agregar otra unidad' }),
      el('button', { type: 'button', className: 'btn btn-danger btn-block', id: 'delete-item', text: 'Eliminar pieza' })
    ])
  ]));

  const marketBody = root.querySelector('#market-body');
  const preferTypes = ['frontal', 'caja', 'etiqueta', 'codigo'];
  const sortedImgs = [...(item.item_images || [])].sort((a, b) => {
    const ia = preferTypes.indexOf(a.image_type);
    const ib = preferTypes.indexOf(b.image_type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const photoPath = sortedImgs[0]?.storage_path;
  const imageUrl = photoPath ? (urls[photoPath] || null) : null;
  paintMarketResult(marketBody, buildInstantMarket(item, { imageUrl }), item);

  root.querySelector('#market-save-manual').addEventListener('click', async () => {
    const raw = root.querySelector('#market-manual-price')?.value;
    try {
      const saved = await saveManualMarketPrice(item, raw);
      Object.assign(item, {
        market_price_median: saved.median,
        market_price_low: saved.low,
        market_price_high: saved.high,
        market_currency: saved.currency,
        market_source: 'manual',
        market_checked_at: saved.checkedAt
      });
      paintMarketResult(marketBody, saved, item);
      toast('Estimado de mercado guardado', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

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
    if (!file) return;
    const status = root.querySelector('#photo-status');
    try {
      const compressed = await compressImage(file);
      status.textContent = 'Procesando…';
      await uploadItemImage(id, compressed, root.querySelector('#img-type').value, (p) => {
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
      await updateItem(id, Object.fromEntries(fd.entries()));
      toast('Guardado', 'ok');
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
 */
function paintMarketResult(host, result, item) {
  if (!host) return;
  host.innerHTML = '';
  const currency = result.currency || 'USD';
  const deal = result.deal || {};

  const stats = el('div', { className: 'market-stats' }, [
    result.median != null
      ? el('div', { className: 'market-stat main' }, [
        el('span', { className: 'market-stat-label', text: 'Mediana' }),
        el('strong', { text: formatMoney(result.median, currency) })
      ])
      : el('div', { className: 'market-stat main' }, [
        el('span', { className: 'market-stat-label', text: 'Mediana' }),
        el('strong', { text: '—' })
      ]),
    result.low != null
      ? el('div', { className: 'market-stat' }, [
        el('span', { className: 'market-stat-label', text: 'Desde' }),
        el('strong', { text: formatMoney(result.low, currency) })
      ])
      : null,
    result.high != null
      ? el('div', { className: 'market-stat' }, [
        el('span', { className: 'market-stat-label', text: 'Hasta' }),
        el('strong', { text: formatMoney(result.high, currency) })
      ])
      : null
  ]);

  const dealEl = el('div', {
    className: `market-deal deal-${deal.code || 'unknown'}`,
  }, [
    el('strong', { text: deal.label || 'Sin veredicto' }),
    el('p', { text: deal.detail || '' }),
    item?.purchase_price != null
      ? el('p', {
        className: 'muted small',
        text: `Tu compra: ${formatMoney(item.purchase_price, item.currency || currency)}`
      })
      : null
  ]);

  host.append(stats, dealEl);

  if (result.note) {
    host.append(el('p', { className: 'muted small', text: result.note }));
  }
  if (result.query) {
    host.append(el('p', { className: 'muted small', text: `Consulta: ${result.query}` }));
  }
  if (result.checkedAt) {
    host.append(el('p', { className: 'muted small', text: `Actualizado: ${formatDate(result.checkedAt)}` }));
  }

  const links = result.links || [];
  if (links.length) {
    const list = el('div', { className: 'market-links' });
    for (const link of links) {
      list.append(
        el('a', {
          className: `market-link region-${link.region}`,
          href: link.url,
          target: '_blank',
          rel: 'noopener noreferrer'
        }, [
          el('span', { className: 'market-link-region', text: link.region }),
          el('span', { className: 'market-link-label', text: link.label }),
          el('span', { className: 'market-link-hint', text: link.hint })
        ])
      );
    }
    host.append(list);
  }

  if (result.listings?.length) {
    const ul = el('ul', { className: 'market-listings' });
    for (const row of result.listings.slice(0, 6)) {
      ul.append(
        el('li', {}, [
          el('span', { className: 'market-listing-title', text: row.title }),
          el('strong', { text: formatMoney(row.price, row.currency || currency) })
        ])
      );
    }
    host.append(el('h3', { className: 'market-listings-title', text: 'Anuncios eBay (muestra)' }), ul);
  }
}
