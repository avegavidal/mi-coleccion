import { el, toast, compressImage, imageTypeLabel, setBusy } from '../utils/dom.js';
import { navigate } from '../utils/router.js';
import {
  recognizeImage,
  formatSimilarity,
  saveIdentificationHistory,
  checkWishlistHints
} from '../services/recognitionService.js';
import { incrementQuantity, getItem } from '../services/collectionService.js';
import { getSignedUrls, listItemImages } from '../services/imageService.js';
import { warmupEmbeddings } from '../services/embeddingService.js';

/** Estado de la sesión de identificación en memoria */
window.__identifyState = window.__identifyState || null;

export async function renderIdentify(root) {
  root.append(el('div', { className: 'page identify-page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Identificar' }),
      el('p', { className: 'page-sub', text: 'Compara una foto nueva con las de TU colección. Tú confirmas.' })
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

  // Restaurar resultados si el usuario vuelve desde Comparación
  const prev = window.__identifyState;
  if (prev?.result && prev?.previewUrl) {
    const workspace = root.querySelector('#id-workspace');
    workspace.append(
      el('section', { className: 'section' }, [
        el('h2', { text: 'Foto analizada' }),
        el('div', { className: 'preview-frame large' }, [el('img', { src: prev.previewUrl, alt: 'Foto nueva' })])
      ])
    );
    renderResults(workspace, prev.result, prev.previewUrl);
  }

  const onFile = async (file) => {
    if (!file) return;
    const workspace = root.querySelector('#id-workspace');
    workspace.innerHTML = '';
    let compressed;
    try {
      compressed = await compressImage(file);
    } catch (err) {
      toast(err.message, 'error');
      return;
    }

    const previewUrl = URL.createObjectURL(compressed);
    workspace.append(
      el('section', { className: 'section' }, [
        el('h2', { text: 'Foto analizada' }),
        el('div', { className: 'preview-frame large' }, [el('img', { src: previewUrl, alt: 'Foto nueva' })]),
        el('p', { className: 'status-line', id: 'id-progress', text: 'Analizando…' })
      ])
    );

    try {
      const result = await recognizeImage(compressed, {
        onProgress: (p) => {
          const line = root.querySelector('#id-progress');
          if (line) line.textContent = p.message || p.stage;
        },
        onModelProgress: (p) => {
          const line = root.querySelector('#id-progress');
          if (line && p.progress != null) line.textContent = `Modelo ${p.progress}%`;
        }
      });

      window.__identifyState = {
        file: compressed,
        previewUrl,
        result
      };

      renderResults(workspace, result, previewUrl);
    } catch (err) {
      console.error(err);
      root.querySelector('#id-progress').textContent = '';
      toast(err.message || 'Error al identificar', 'error');
      workspace.append(el('p', { className: 'error-text', text: err.message }));
    }
  };

  root.querySelector('#id-cam').addEventListener('change', (e) => onFile(e.target.files?.[0]));
  root.querySelector('#id-gal').addEventListener('change', (e) => onFile(e.target.files?.[0]));
}

function renderResults(workspace, result, previewUrl) {
  const existing = workspace.querySelector('#results-block');
  if (existing) existing.remove();

  const { strongMatches, weakMatches, settings, hasClearMatch } = result;
  const block = el('div', { id: 'results-block' });

  if (!strongMatches.length) {
    block.append(
      el('div', { className: 'notice notice-warn' }, [
        el('h2', { text: 'No encontramos una coincidencia clara en tu colección.' }),
        el('p', { text: 'Puedes agregar esta pieza como nueva, o revisar las parecidas abajo.' }),
        el('button', {
          type: 'button',
          className: 'btn btn-primary btn-block',
          text: 'Agregar a mi colección',
          onClick: () => {
            window.__pendingIdentifyFile = window.__identifyState?.file;
            navigate('add');
          }
        })
      ])
    );
  } else {
    block.append(
      el('section', { className: 'section' }, [
        el('h2', { text: hasClearMatch ? 'Posibles coincidencias' : 'Posibles coincidencias' }),
        el('p', { className: 'muted', text: 'La similitud es una orientación, no una certeza. Confirma tú.' }),
        el('div', { className: 'match-list', id: 'strong-list' })
      ])
    );
  }

  const strongList = block.querySelector('#strong-list') || block.appendChild(el('div', { className: 'match-list' }));
  for (const m of strongMatches) {
    strongList.append(matchCard(m, previewUrl));
  }

  if (weakMatches.length) {
    block.append(
      el('section', { className: 'section' }, [
        el('h2', { text: 'Parecidas (coincidencia baja)' }),
        el('p', { className: 'muted', text: 'Estas piezas son visualmente parecidas, pero la coincidencia es baja.' }),
        el('div', { className: 'match-list', id: 'weak-list' })
      ])
    );
    const weakList = block.querySelector('#weak-list');
    for (const m of weakMatches) weakList.append(matchCard(m, previewUrl));
  }

  if (strongMatches.length || weakMatches.length) {
    block.append(
      el('button', {
        type: 'button',
        className: 'btn btn-ghost btn-block',
        text: 'No es ninguna — agregar nueva',
        onClick: async () => {
          try {
            await saveIdentificationHistory({
              results: summarize(result),
              outcome: 'added_new'
            });
          } catch { /* optional */ }
          window.__pendingIdentifyFile = window.__identifyState?.file;
          navigate('add');
        }
      })
    );
  }

  workspace.append(block);
}

function summarize(result) {
  return (result.matches || []).slice(0, 10).map((m) => ({
    itemId: m.itemId,
    name: m.name,
    similarity: m.similarity
  }));
}

function matchCard(match, previewUrl) {
  return el('article', { className: `match-card level-${match.level}` }, [
    el('div', { className: 'match-photo' }, [
      match.bestImageUrl
        ? el('img', { src: match.bestImageUrl, alt: match.name, loading: 'lazy' })
        : el('div', { className: 'photo-placeholder', text: '?' })
    ]),
    el('div', { className: 'match-body' }, [
      el('p', { className: 'match-tag', text: 'Posible coincidencia' }),
      el('h3', { text: match.name }),
      el('p', { className: 'muted', text: [match.franchise, match.manufacturer, match.collectionName].filter(Boolean).join(' · ') }),
      el('p', { className: 'sim-score', text: `${formatSimilarity(match.similarity)} de similitud visual` }),
      el('button', {
        type: 'button',
        className: 'btn btn-primary btn-block',
        text: 'Ver comparación',
        onClick: () => {
          window.__identifyState = {
            ...window.__identifyState,
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
  const state = window.__identifyState;
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
