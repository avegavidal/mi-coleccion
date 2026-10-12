import { el, emptyState, formatDate, formatMoneyDual, forceAppUpdate, toast } from '../utils/dom.js';
import { getDashboardStats, listItems } from '../services/collectionService.js';
import { enrichItemsWithThumbs } from '../services/exportService.js';
import { classifyDeal } from '../services/marketPriceService.js';

function updateAppButton() {
  return el('button', {
    type: 'button',
    className: 'btn btn-primary btn-block',
    text: 'Actualizar app (borrar caché)',
    onClick: async () => {
      toast('Borrando caché…', 'info');
      // update.html es más fiable en iPhone que solo location.replace
      try {
        sessionStorage.setItem('mi_coleccion_update_pass', '1');
      } catch { /* ignore */ }
      location.href = new URL(`update.html?_=${Date.now()}`, location.href).href;
    }
  });
}

export async function renderDashboard(root) {
  const ver = window.APP_CONFIG?.APP_VERSION || '?';
  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Mi Colección' }),
      el('p', { className: 'page-sub', text: 'Tu vitrina, fotos y mercado en un solo lugar.' }),
      el('p', { className: 'muted small', text: `Versión ${ver}` })
    ]),
    el('a', { href: '#/identify', className: 'identify-hero-btn' }, [
      el('span', { className: 'identify-icon', text: '📷' }),
      el('span', { className: 'identify-text' }, [
        el('strong', { text: 'Identificar figura' }),
        el('small', { text: 'Toma una foto y busca coincidencias en tu colección' })
      ])
    ]),
    el('div', { className: 'stats-grid stats-compact', id: 'dash-stats' }, [
      el('div', { className: 'stat-card skeleton', text: '…' })
    ]),
    el('section', { className: 'section' }, [
      el('div', { className: 'section-head' }, [
        el('h2', { text: 'Últimas incorporaciones' }),
        el('a', { href: '#/collection', className: 'link', text: 'Ver todo' })
      ]),
      el('div', { className: 'card-grid', id: 'dash-recent' })
    ])
  ]));

  const statsEl = root.querySelector('#dash-stats');
  const recentHost = root.querySelector('#dash-recent');
  try {
    const stats = await getDashboardStats();
    statsEl.innerHTML = '';
    const cards = [
      { label: 'Piezas', value: stats.totalPieces, href: '#/collection' },
      { label: 'Categorías', value: stats.totalCollections, href: '#/collections' },
      { label: 'Wishlist', value: stats.wishlistCount, href: '#/wishlist' }
    ];
    for (const c of cards) {
      statsEl.append(
        el('a', { href: c.href, className: 'stat-card' }, [
          el('div', { className: 'stat-value', text: String(c.value) }),
          el('div', { className: 'stat-label', text: c.label })
        ])
      );
    }

    if (!stats.recent.length) {
      recentHost.replaceWith(
        emptyState(
          'Tu vitrina está vacía',
          'Agrega tu primera figura o identifícala con la cámara.',
          el('a', { href: '#/add', className: 'btn btn-primary', text: 'Agregar pieza' })
        )
      );
      return;
    }

    try {
      const ids = stats.recent.map((r) => r.id);
      const filtered = await listItems({ ids, sort: 'newest' });
      const withThumbs = await enrichItemsWithThumbs(filtered);
      withThumbs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      recentHost.innerHTML = '';
      for (const item of withThumbs.slice(0, 6)) {
        recentHost.append(itemCard(item));
      }
    } catch (listErr) {
      recentHost.innerHTML = '';
      recentHost.append(el('div', { className: 'notice notice-warn' }, [
        el('p', { className: 'error-text', text: listErr.message || 'No se pudieron cargar las piezas recientes' }),
        updateAppButton()
      ]));
    }
  } catch (err) {
    statsEl.innerHTML = '';
    statsEl.append(el('div', { className: 'notice notice-warn' }, [
      el('p', { className: 'error-text', text: err.message || 'Error al cargar' }),
      el('p', {
        className: 'muted small',
        text: 'Si ves un error de “embed / collections”, tu iPhone tiene JS en caché. Pulsa actualizar.'
      }),
      updateAppButton()
    ]));
  }
}

export function itemCard(item) {
  const deal = item.market_price_median != null
    ? classifyDeal(item.purchase_price, item.market_price_median)
    : null;
  const showDeal = deal && deal.code !== 'unknown_purchase' && deal.code !== 'unknown_market';
  const path = item.thumbPath || (item.item_images || [])[0]?.storage_path || '';

  const photo = el('div', { className: 'item-card-photo' });
  if (item.thumbUrl) {
    const img = document.createElement('img');
    img.src = item.thumbUrl;
    img.alt = item.name || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 360;
    img.height = 480;
    img.fetchPriority = 'low';
    if (path) img.dataset.storagePath = path;
    img.addEventListener('load', () => {
      if (!path) return;
      import('../services/imageService.js').then((m) => m.markThumbReady(path)).catch(() => {});
    }, { once: true });
    img.addEventListener('error', () => {
      const ph = el('div', {
        className: 'photo-placeholder photo-loading',
        dataset: path ? { storagePath: path } : undefined,
        text: '…'
      });
      img.replaceWith(ph);
      if (path) {
        import('../services/imageService.js')
          .then((m) => m.ensureRemoteThumb(path))
          .then((url) => {
            if (!url || !ph.isConnected) return;
            const next = document.createElement('img');
            next.src = url;
            next.alt = item.name || '';
            next.loading = 'lazy';
            next.decoding = 'async';
            next.width = 360;
            next.height = 480;
            next.dataset.storagePath = path;
            next.dataset.thumbReady = '1';
            ph.replaceWith(next);
          })
          .catch(() => {});
      }
    }, { once: true });
    photo.append(img);
  } else if (path) {
    photo.append(el('div', {
      className: 'photo-placeholder photo-loading',
      dataset: { storagePath: path },
      text: '…'
    }));
    import('../services/imageService.js')
      .then((m) => m.scheduleThumbBackfill([path]))
      .catch(() => {});
  } else {
    photo.append(el('div', { className: 'photo-placeholder', text: 'Sin foto' }));
  }

  return el('a', { href: `#/item/${item.id}`, className: 'item-card' }, [
    photo,
    el('p', { className: 'qty-badge', text: `×${item.quantity || 1}` }),
    el('div', { className: 'item-card-body' }, [
      el('div', { className: 'item-card-main' }, [
        el('h3', { text: item.name }),
        el('p', { className: 'muted', text: item.collectionNames || item.collections?.name || 'Sin categoría' }),
        item.manufacturer ? el('p', { className: 'card-meta', text: item.manufacturer }) : null
      ]),
      el('div', { className: 'item-card-aside' }, [
        el('p', {
          className: `card-market${item.market_price_median == null ? ' hidden' : ''}`,
          dataset: { marketFor: item.id },
          text: item.market_price_median != null
            ? formatMoneyDual(item.market_price_median, item.market_currency || 'USD')
            : ''
        }),
        el('p', {
          className: `card-deal${showDeal ? ` deal-${deal.code}` : ' hidden'}`,
          dataset: { dealFor: item.id },
          text: showDeal ? deal.label : ''
        })
      ])
    ])
  ]);
}
