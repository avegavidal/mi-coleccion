import { el, emptyState, formatDate, formatMoney } from '../utils/dom.js';
import { getDashboardStats, listItems } from '../services/collectionService.js';
import { enrichItemsWithThumbs } from '../services/exportService.js';
import { classifyDeal } from '../services/marketPriceService.js';

export async function renderDashboard(root) {
  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Inicio' }),
      el('p', { className: 'page-sub', text: 'Tu vitrina, fotos y mercado en un solo lugar.' })
    ]),
    el('a', { href: '#/identify', className: 'identify-hero-btn' }, [
      el('span', { className: 'identify-icon', text: '📷' }),
      el('span', { className: 'identify-text' }, [
        el('strong', { text: 'Identificar figura' }),
        el('small', { text: 'Toma una foto y busca coincidencias en tu colección' })
      ])
    ]),
    el('div', { className: 'stats-grid', id: 'dash-stats' }, [
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

  try {
    const stats = await getDashboardStats();
    const statsEl = root.querySelector('#dash-stats');
    statsEl.innerHTML = '';
    const cards = [
      { label: 'Piezas', value: stats.totalPieces, href: '#/collection' },
      { label: 'Registros', value: stats.totalItems, href: '#/collection' },
      { label: 'Categorías', value: stats.totalCollections, href: '#/collections' },
      { label: 'Duplicados', value: stats.duplicatesCount, href: '#/duplicates' },
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

    const recentHost = root.querySelector('#dash-recent');
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

    const ids = stats.recent.map((r) => r.id);
    const items = await listItems();
    const filtered = items.filter((i) => ids.includes(i.id));
    const withThumbs = await enrichItemsWithThumbs(filtered);
    withThumbs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    for (const item of withThumbs.slice(0, 6)) {
      recentHost.append(itemCard(item));
    }
  } catch (err) {
    root.querySelector('#dash-stats').innerHTML = `<p class="error-text">${err.message}</p>`;
  }
}

export function itemCard(item) {
  const deal = item.market_price_median != null
    ? classifyDeal(item.purchase_price, item.market_price_median)
    : null;
  const showDeal = deal && deal.code !== 'unknown_purchase' && deal.code !== 'unknown_market';

  return el('a', { href: `#/item/${item.id}`, className: 'item-card' }, [
    el('div', {
      className: 'item-card-photo',
      html: item.thumbUrl
        ? `<img src="${item.thumbUrl}" alt="${(item.name || '').replace(/"/g, '')}" loading="lazy">`
        : '<div class="photo-placeholder">Sin foto</div>'
    }),
    el('p', { className: 'qty-badge', text: `×${item.quantity || 1}` }),
    el('div', { className: 'item-card-body' }, [
      el('h3', { text: item.name }),
      el('p', { className: 'muted', text: item.collections?.name || 'Sin categoría' }),
      item.manufacturer ? el('p', { className: 'card-meta', text: item.manufacturer }) : null,
      el('p', {
        className: `card-market${item.market_price_median == null ? ' hidden' : ''}`,
        dataset: { marketFor: item.id },
        text: item.market_price_median != null
          ? formatMoney(item.market_price_median, item.market_currency || 'USD')
          : ''
      }),
      el('p', {
        className: `card-deal${showDeal ? ` deal-${deal.code}` : ' hidden'}`,
        dataset: { dealFor: item.id },
        text: showDeal ? deal.label : ''
      })
    ])
  ]);
}
