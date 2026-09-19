import { el, emptyState, toast, setBusy, compressImage, imageTypeLabel, formatMoney, formatDate } from '../utils/dom.js';
import { itemCard } from './dashboard.js';
import {
  listItems, listCollections, createItem, getItem, updateItem,
  deleteItem, incrementQuantity, createCollection, getDuplicateItems
} from '../services/collectionService.js';
import { enrichItemsWithThumbs } from '../services/exportService.js';
import { uploadItemImage, deleteImageRecord, getSignedUrl, getSignedUrls } from '../services/imageService.js';
import { navigate } from '../utils/router.js';

export async function renderCollection(root) {
  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header row-between' }, [
      el('div', {}, [
        el('h1', { text: 'Mi colección' }),
        el('p', { className: 'page-sub', text: 'Busca, filtra y organiza.' })
      ]),
      el('a', { href: '#/add', className: 'btn btn-primary btn-round', text: '+' })
    ]),
    el('div', { className: 'filters' }, [
      el('input', { type: 'search', id: 'q', placeholder: 'Buscar nombre, marca, serie…', className: 'input' }),
      el('select', { id: 'filter-collection', className: 'input' }, [el('option', { value: '', text: 'Todas las colecciones' })]),
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
  await load();
}

export async function renderAdd(root, params = []) {
  const prefillPhoto = window.__pendingIdentifyFile || null;
  const collections = await listCollections();

  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Agregar pieza' }),
      el('p', { className: 'page-sub', text: 'Foto → nombre → guardar. El resto después.' })
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
      el('label', {}, [
        el('span', { text: 'Nombre *' }),
        el('input', { className: 'input', name: 'name', required: true, placeholder: 'Ej. Spider-Man #123' })
      ]),
      el('label', {}, [
        el('span', { text: 'Colección' }),
        el('select', { className: 'input', name: 'collection_id' }, [
          el('option', { value: '', text: 'Sin colección' }),
          ...collections.map((c) => el('option', { value: c.id, text: c.name }))
        ])
      ]),
      el('details', { className: 'more-fields' }, [
        el('summary', { text: 'Más detalles (opcional)' }),
        ...['manufacturer', 'franchise', 'series', 'item_number', 'character_name', 'category'].map((name) =>
          el('label', {}, [
            el('span', { text: labelFor(name) }),
            el('input', { className: 'input', name })
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
  const preview = root.querySelector('#preview');

  const setPhoto = async (file) => {
    if (!file) return;
    photoFile = await compressImage(file);
    preview.innerHTML = '';
    const img = el('img', { alt: 'Vista previa' });
    img.src = URL.createObjectURL(photoFile);
    preview.append(img);
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
    el('div', { className: 'btn-stack' }, [
      el('a', { href: `#/edit/${item.id}`, className: 'btn btn-primary btn-block', text: 'Editar' }),
      el('button', { type: 'button', className: 'btn btn-ghost btn-block', id: 'add-unit', text: '+ Agregar otra unidad' }),
      el('button', { type: 'button', className: 'btn btn-danger btn-block', id: 'delete-item', text: 'Eliminar pieza' })
    ])
  ]));

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
        el('span', { text: 'Colección' }),
        el('select', { className: 'input', name: 'collection_id' }, [
          el('option', { value: '', text: 'Sin colección' }),
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

export async function renderCollectionsManage(root) {
  const collections = await listCollections();
  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Colecciones' }),
      el('p', { className: 'page-sub', text: 'Organiza como quieras. No hay límites fijos.' })
    ]),
    el('form', { id: 'new-col', className: 'inline-form' }, [
      el('input', { className: 'input', name: 'name', placeholder: 'Nueva colección', required: true }),
      el('button', { className: 'btn btn-primary', type: 'submit', text: 'Crear' })
    ]),
    el('ul', { className: 'list-plain', id: 'col-list' })
  ]));

  const list = root.querySelector('#col-list');
  for (const c of collections) {
    list.append(el('li', { className: 'list-row' }, [
      el('span', { text: c.name }),
      el('a', { href: `#/collection?c=${c.id}`, className: 'link', text: 'Ver' })
    ]));
  }

  root.querySelector('#new-col').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name');
    try {
      await createCollection(name);
      toast('Colección creada', 'ok');
      location.reload();
    } catch (err) {
      toast(err.message, 'error');
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
