import { el, emptyState, toast, setBusy, formatMoney } from '../utils/dom.js';
import {
  listCollections,
  listCollectionsWithStats,
  createCollection,
  updateCollection,
  deleteCollection,
  getCollection,
  listItems,
  updateItem
} from '../services/collectionService.js';
import { getSignedUrls } from '../services/imageService.js';
import { itemCard } from './dashboard.js';
import { enrichItemsWithThumbs } from '../services/exportService.js';
import { navigate } from '../utils/router.js';

const CATEGORY_COLORS = [
  '#0f766e', '#0369a1', '#7c3aed', '#db2777',
  '#ea580c', '#ca8a04', '#16a34a', '#334155'
];

export async function renderCollectionsManage(root) {
  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Categorías' }),
      el('p', { className: 'page-sub', text: 'Organiza tus figuras y edita a cuáles pertenece cada una.' })
    ]),
    el('form', { id: 'new-cat', className: 'category-create stack-form' }, [
      el('label', {}, [
        el('span', { text: 'Nueva categoría' }),
        el('input', { className: 'input', name: 'name', placeholder: 'Ej. Nendoroid, Scale, Gunpla…', required: true })
      ]),
      el('div', { className: 'color-chips', id: 'new-cat-colors' }),
      el('input', { type: 'hidden', name: 'color', id: 'new-cat-color', value: CATEGORY_COLORS[0] }),
      el('button', { className: 'btn btn-primary', type: 'submit', text: 'Crear categoría' })
    ]),
    el('div', { className: 'category-grid', id: 'cat-grid' }, [
      el('p', { className: 'muted', text: 'Cargando…' })
    ])
  ]));

  paintColorChips(root.querySelector('#new-cat-colors'), root.querySelector('#new-cat-color'), CATEGORY_COLORS[0]);

  root.querySelector('#new-cat').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    setBusy(btn, true, 'Creando…');
    try {
      const created = await createCollection(fd.get('name'), null, fd.get('color') || CATEGORY_COLORS[0]);
      toast('Categoría creada', 'ok');
      navigate(`category/${created.id}`);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(btn, false);
    }
  });

  try {
    const stats = await listCollectionsWithStats();
    const allPaths = stats.flatMap((c) => c.previewPaths || []);
    const urls = await getSignedUrls(allPaths, 3600, { variant: 'thumb' });
    const grid = root.querySelector('#cat-grid');
    grid.innerHTML = '';

    if (!stats.length) {
      grid.append(emptyState('Sin categorías', 'Crea la primera para agrupar tus figuras.'));
      return;
    }

    for (const c of stats) {
      const mosaic = el('div', { className: 'category-mosaic' });
      const paths = c.previewPaths || [];
      for (let i = 0; i < 4; i++) {
        const path = paths[i];
        if (path && urls[path]) {
          mosaic.append(el('img', { src: urls[path], alt: '', loading: 'lazy' }));
        } else {
          mosaic.append(el('div', { className: 'mosaic-empty', text: i === 0 && !paths.length ? 'Vacía' : '' }));
        }
      }

      grid.append(
        el('a', { href: `#/category/${c.id}`, className: 'category-card' }, [
          mosaic,
          el('div', { className: 'category-card-body' }, [
            el('span', { className: 'category-swatch', style: `background:${c.color || CATEGORY_COLORS[0]}` }),
            el('h3', { text: c.name }),
            el('span', { className: 'category-count', text: `${c.itemCount} fig.` })
          ])
        ])
      );
    }

    const uncategorized = (await listItems()).filter((i) => !i.collection_id);
    if (uncategorized.length) {
      grid.append(
        el('a', { href: '#/category/none', className: 'category-card' }, [
          el('div', { className: 'category-mosaic' }, [
            el('div', { className: 'mosaic-empty', text: 'Sin categoría' })
          ]),
          el('div', { className: 'category-card-body' }, [
            el('span', { className: 'category-swatch', style: 'background:#94a3b8' }),
            el('h3', { text: 'Sin categoría' }),
            el('span', { className: 'category-count', text: `${uncategorized.length} fig.` })
          ])
        ])
      );
    }
  } catch (err) {
    root.querySelector('#cat-grid').innerHTML = `<p class="error-text">${err.message}</p>`;
  }
}

export async function renderCategoryDetail(root, params) {
  const id = params[0];
  if (!id) {
    root.append(el('p', { text: 'Categoría no encontrada' }));
    return;
  }

  const isNone = id === 'none';
  const collections = await listCollections();
  let category = null;
  if (!isNone) {
    try {
      category = await getCollection(id);
    } catch {
      root.append(el('p', { text: 'Categoría no encontrada' }));
      return;
    }
  }

  const allItems = await listItems();
  const members = isNone
    ? allItems.filter((i) => !i.collection_id)
    : allItems.filter((i) => i.collection_id === id);
  const withThumbs = await enrichItemsWithThumbs(members);

  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('a', { href: '#/collections', className: 'back-link', text: '← Categorías' }),
      el('h1', { text: isNone ? 'Sin categoría' : category.name }),
      el('p', {
        className: 'page-sub',
        text: isNone
          ? 'Figuras que aún no están en ninguna categoría.'
          : (category.description || `${withThumbs.length} figura(s) en esta categoría`)
      })
    ]),
    isNone ? null : el('form', { id: 'cat-edit', className: 'stack-form' }, [
      el('label', {}, [
        el('span', { text: 'Nombre' }),
        el('input', { className: 'input', name: 'name', value: category.name, required: true })
      ]),
      el('label', {}, [
        el('span', { text: 'Descripción' }),
        el('textarea', { className: 'input', name: 'description', rows: '2', text: category.description || '' })
      ]),
      el('div', {}, [
        el('span', { className: 'muted', text: 'Color' }),
        el('div', { className: 'color-chips', id: 'edit-cat-colors', style: 'margin-top:8px' }),
        el('input', { type: 'hidden', name: 'color', id: 'edit-cat-color', value: category.color || CATEGORY_COLORS[0] })
      ]),
      el('div', { className: 'btn-stack' }, [
        el('button', { type: 'submit', className: 'btn btn-primary btn-block', text: 'Guardar categoría' }),
        el('button', { type: 'button', className: 'btn btn-danger btn-block', id: 'cat-delete', text: 'Eliminar categoría' })
      ])
    ]),
    el('section', { className: 'section' }, [
      el('div', { className: 'section-head' }, [
        el('h2', { text: 'Figuras asignadas' }),
        el('span', { className: 'muted', text: `${withThumbs.length}` })
      ]),
      el('div', { id: 'cat-figures' })
    ]),
    isNone ? null : el('section', { className: 'section' }, [
      el('h2', { text: 'Agregar figuras' }),
      el('p', { className: 'page-sub', text: 'Elige una figura de otra categoría o sin asignar.' }),
      el('div', { id: 'cat-add-list' })
    ])
  ]));

  if (!isNone) {
    paintColorChips(
      root.querySelector('#edit-cat-colors'),
      root.querySelector('#edit-cat-color'),
      category.color || CATEGORY_COLORS[0]
    );

    root.querySelector('#cat-edit').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type=submit]');
      setBusy(btn, true, 'Guardando…');
      try {
        await updateCollection(id, {
          name: String(fd.get('name') || '').trim(),
          description: String(fd.get('description') || '').trim() || null,
          color: fd.get('color') || CATEGORY_COLORS[0]
        });
        toast('Categoría actualizada', 'ok');
        navigate(`category/${id}`, true);
        location.reload();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setBusy(btn, false);
      }
    });

    root.querySelector('#cat-delete').addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta categoría? Las figuras quedarán sin categoría.')) return;
      try {
        await deleteCollection(id);
        toast('Categoría eliminada', 'ok');
        navigate('collections', true);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const figuresHost = root.querySelector('#cat-figures');
  if (!withThumbs.length) {
    figuresHost.append(emptyState('Nada aquí', 'Asigna figuras a esta categoría.'));
  } else {
    for (const item of withThumbs) {
      figuresHost.append(buildAssignRow(item, collections, () => {
        navigate(`category/${id}`, true);
        location.reload();
      }));
    }
  }

  const addHost = root.querySelector('#cat-add-list');
  if (addHost && !isNone) {
    const candidates = allItems.filter((i) => i.collection_id !== id);
    if (!candidates.length) {
      addHost.append(el('p', { className: 'muted', text: 'Todas tus figuras ya están en esta categoría.' }));
    } else {
      const enriched = await enrichItemsWithThumbs(candidates.slice(0, 40));
      for (const item of enriched) {
        addHost.append(
          el('div', { className: 'figure-assign-row' }, [
            item.thumbUrl
              ? el('img', { src: item.thumbUrl, alt: '', loading: 'lazy' })
              : el('div', { className: 'thumb-ph', text: '—' }),
            el('div', {}, [
              el('h4', { text: item.name }),
              el('p', {
                className: 'muted small',
                text: item.collections?.name || 'Sin categoría'
              })
            ]),
            el('button', {
              type: 'button',
              className: 'btn btn-ghost',
              text: 'Agregar',
              onclick: async () => {
                try {
                  await updateItem(item.id, { collection_id: id });
                  toast('Figura agregada', 'ok');
                  navigate(`category/${id}`, true);
                  location.reload();
                } catch (err) {
                  toast(err.message, 'error');
                }
              }
            })
          ])
        );
      }
    }
  }
}

function buildAssignRow(item, collections, onChanged) {
  const select = el('select', {
    className: 'input',
    onchange: async (e) => {
      const val = e.target.value || null;
      try {
        await updateItem(item.id, { collection_id: val });
        toast('Categoría actualizada', 'ok');
        onChanged?.();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  }, [
    el('option', { value: '', text: 'Sin categoría', ...(!item.collection_id ? { selected: true } : {}) }),
    ...collections.map((c) =>
      el('option', {
        value: c.id,
        text: c.name,
        ...(c.id === item.collection_id ? { selected: true } : {})
      })
    )
  ]);

  return el('div', { className: 'figure-assign-row' }, [
    item.thumbUrl
      ? el('img', { src: item.thumbUrl, alt: '', loading: 'lazy' })
      : el('div', { className: 'thumb-ph', text: '—' }),
    el('div', {}, [
      el('a', { href: `#/item/${item.id}` }, [el('h4', { text: item.name })]),
      el('p', {
        className: 'muted small',
        text: [item.manufacturer, item.purchase_price != null ? formatMoney(item.purchase_price, item.currency) : null]
          .filter(Boolean)
          .join(' · ') || '—'
      })
    ]),
    select
  ]);
}

function paintColorChips(host, hiddenInput, selected) {
  if (!host || !hiddenInput) return;
  host.innerHTML = '';
  for (const color of CATEGORY_COLORS) {
    const chip = el('button', {
      type: 'button',
      className: `color-chip${color === selected ? ' selected' : ''}`,
      style: `background:${color}`,
      'aria-label': color,
      onclick: () => {
        hiddenInput.value = color;
        host.querySelectorAll('.color-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
      }
    });
    host.append(chip);
  }
}

// Re-export itemCard usage helper for collection grid links
export { itemCard };
