/**
 * Alta masiva de figuras: cámara → recorte → otra foto (mismo flujo) → guardar lote.
 */
import { el, toast, setBusy } from '../utils/dom.js';
import { prepareImageForAnalysis } from '../utils/imageCrop.js';
import { listCollections, createItem } from '../services/collectionService.js';
import { uploadItemImage } from '../services/imageService.js';
import { identifyFigureFromPhoto } from '../services/visionIdentifyService.js';
import { navigate } from '../utils/router.js';

const CONCURRENCY = 2;

function uid() {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @typedef {{
 *  id: string,
 *  file: File|null,
 *  objectUrl: string,
 *  name: string,
 *  manufacturer: string,
 *  franchise: string,
 *  series: string,
 *  character_name: string,
 *  category: string,
 *  item_number: string,
 *  year: string,
 *  status: 'queued'|'identifying'|'ready'|'error'|'saving'|'saved',
 *  note: string,
 *  itemId?: string
 * }} BulkRow
 */

export async function renderAddBulk(root) {
  const collections = await listCollections();

  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('a', { href: '#/add', className: 'back-link', text: '← Una sola' }),
      el('h1', { text: 'Agregar varias' }),
      el('p', {
        className: 'page-sub',
        text: 'Mismo flujo que una sola: foto → recorte → y puedes tomar otra. Al final guardas el lote.'
      })
    ]),
    el('div', { className: 'bulk-toolbar' }, [
      el('label', {
        className: 'btn btn-primary',
        html: '📷 Tomar foto<input type="file" accept="image/*" capture="environment" id="bulk-cam" hidden>'
      }),
      el('label', {
        className: 'btn btn-ghost',
        html: 'Galería<input type="file" accept="image/*" multiple id="bulk-gallery" hidden>'
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-ghost',
        id: 'bulk-clear',
        text: 'Vaciar cola'
      })
    ]),
    el('p', { className: 'status-line muted', id: 'bulk-status', text: 'Aún no hay fotos en la cola.' }),
    el('div', { className: 'identify-progress', id: 'bulk-progress', hidden: true }, [
      el('p', { className: 'identify-progress-label', id: 'bulk-progress-label', text: 'Identificando…' }),
      el('div', { className: 'identify-progress-track', 'aria-hidden': 'true' })
    ]),
    el('div', { className: 'bulk-list', id: 'bulk-list' }),
    el('section', { className: 'section bulk-shared', id: 'bulk-shared', hidden: true }, [
      el('h2', { text: 'Categorías para todas' }),
      el('p', { className: 'muted small', text: 'Opcional: se aplican al guardar el lote.' }),
      categoryChecks(collections)
    ]),
    el('div', { className: 'bulk-actions sticky-actions', id: 'bulk-actions', hidden: true }, [
      el('button', {
        type: 'button',
        className: 'btn btn-ghost btn-block',
        id: 'bulk-another',
        text: '📷 Tomar otra foto'
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-primary btn-block',
        id: 'bulk-save',
        text: 'Guardar todas'
      })
    ])
  ]));

  /** @type {BulkRow[]} */
  let rows = [];
  let identifyRunning = false;
  let saveRunning = false;
  let prepareRunning = false;

  const listEl = root.querySelector('#bulk-list');
  const statusEl = root.querySelector('#bulk-status');
  const progressEl = root.querySelector('#bulk-progress');
  const progressLabel = root.querySelector('#bulk-progress-label');
  const sharedEl = root.querySelector('#bulk-shared');
  const actionsEl = root.querySelector('#bulk-actions');
  const saveBtn = root.querySelector('#bulk-save');
  const anotherBtn = root.querySelector('#bulk-another');
  const camInput = root.querySelector('#bulk-cam');
  const galleryInput = root.querySelector('#bulk-gallery');

  const readSharedCollectionIds = () =>
    [...root.querySelectorAll('input[name="bulk_collection_ids"]:checked')].map((i) => i.value);

  const openCamera = () => {
    if (prepareRunning || saveRunning) return;
    if (camInput) {
      camInput.value = '';
      camInput.click();
    }
  };

  const recount = () => {
    const n = rows.length;
    const ready = rows.filter((r) => r.status === 'ready' && r.name.trim()).length;
    const identifying = rows.filter((r) => r.status === 'identifying' || r.status === 'queued').length;
    const errors = rows.filter((r) => r.status === 'error').length;
    const saved = rows.filter((r) => r.status === 'saved').length;
    sharedEl.hidden = n === 0;
    actionsEl.hidden = n === 0;
    if (!n) {
      statusEl.textContent = 'Aún no hay fotos en la cola.';
      saveBtn.textContent = 'Guardar todas';
      return;
    }
    statusEl.textContent = [
      `${n} foto${n === 1 ? '' : 's'}`,
      ready ? `${ready} lista${ready === 1 ? '' : 's'}` : null,
      identifying ? `${identifying} identificando` : null,
      errors ? `${errors} con error` : null,
      saved ? `${saved} guardada${saved === 1 ? '' : 's'}` : null
    ].filter(Boolean).join(' · ');
    const toSave = rows.filter((r) => r.status !== 'saved' && r.name.trim()).length;
    saveBtn.textContent = toSave ? `Guardar ${toSave}` : 'Guardar todas';
    saveBtn.disabled = saveRunning || prepareRunning || !toSave;
    if (anotherBtn) anotherBtn.disabled = prepareRunning || saveRunning;
  };

  const paintList = () => {
    listEl.innerHTML = '';
    for (const row of rows) {
      listEl.append(rowCard(row, {
        onName: (v) => {
          row.name = v;
          if (row.status === 'error' && v.trim()) row.status = 'ready';
          recount();
        },
        onRemove: () => {
          try { URL.revokeObjectURL(row.objectUrl); } catch { /* ignore */ }
          rows = rows.filter((r) => r.id !== row.id);
          paintList();
          recount();
        }
      }));
    }
    recount();
  };

  const setProgress = (active, message) => {
    if (progressEl) progressEl.hidden = !active;
    if (message && progressLabel) progressLabel.textContent = message;
  };

  const pushRow = (prepared) => {
    const objectUrl = URL.createObjectURL(prepared);
    rows.push({
      id: uid(),
      file: prepared,
      objectUrl,
      name: '',
      manufacturer: '',
      franchise: '',
      series: '',
      character_name: '',
      category: '',
      item_number: '',
      year: '',
      status: 'queued',
      note: ''
    });
  };

  const isImageFile = (f) => {
    if (!f) return false;
    if (f.type?.startsWith('image/')) return true;
    // iOS a veces deja type vacío en fotos de cámara
    return !f.type || /\.(jpe?g|png|heic|heif|webp|gif|bmp|tif?f)$/i.test(f.name || '');
  };

  /**
   * Copia los File antes de vaciar el input (en iPhone FileList es live y queda vacía).
   * @param {HTMLInputElement|null} input
   * @returns {File[]}
   */
  const takeFilesFromInput = (input) => {
    const list = input?.files ? [...input.files] : [];
    if (input) input.value = '';
    return list.filter(isImageFile);
  };

  /**
   * Una o varias fotos: cada una pasa por el recorte (igual que alta simple).
   * @param {FileList|File[]} fileList
   * @param {{ offerAnother?: boolean }} [opts]
   */
  const enqueueFiles = async (fileList, opts = {}) => {
    const files = [...(fileList || [])].filter(isImageFile);
    if (!files.length) {
      toast('No hay imágenes en la selección', 'info');
      return;
    }
    if (prepareRunning) {
      toast('Espera a terminar el recorte actual', 'info');
      return;
    }

    prepareRunning = true;
    recount();
    let added = 0;
    let cancelled = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const label = files.length > 1
          ? `Recorta ${i + 1}/${files.length}…`
          : 'Recorta la figura (o usa foto completa)…';
        setProgress(true, label);
        try {
          const prepared = await prepareImageForAnalysis(file, {
            skipCrop: false,
            cropTitle: files.length > 1
              ? `Recortar figura (${i + 1}/${files.length})`
              : 'Recortar figura'
          });
          if (!prepared) {
            cancelled += 1;
            continue;
          }
          pushRow(prepared);
          added += 1;
          paintList();
          runIdentifyQueue();
        } catch (err) {
          console.warn('[bulk] prepare falló', err);
          toast(err?.message || 'No se pudo usar esa foto', 'error');
        }
      }
    } finally {
      prepareRunning = false;
      setProgress(false);
      recount();
    }

    if (!added) {
      toast(
        cancelled ? 'Recorte cancelado — toma la foto de nuevo' : 'No se agregó ninguna foto',
        'info'
      );
      return;
    }
    toast(
      added === 1 ? 'Foto en cola — puedes tomar otra' : `${added} fotos en cola`,
      'ok'
    );
  };

  const runIdentifyQueue = async () => {
    if (identifyRunning) return;
    identifyRunning = true;
    try {
      const pending = () => rows.filter((r) => r.status === 'queued');
      while (pending().length) {
        const batch = pending().slice(0, CONCURRENCY);
        setProgress(true, `Identificando ${batch.length}… (${pending().length} en cola)`);
        await Promise.all(batch.map((row) => identifyOne(row)));
        paintList();
      }
    } finally {
      identifyRunning = false;
      if (!prepareRunning) setProgress(false);
      recount();
      if (rows.some((r) => r.status === 'queued')) runIdentifyQueue();
    }
  };

  const identifyOne = async (row) => {
    row.status = 'identifying';
    row.note = 'Identificando…';
    try {
      const suggestion = await identifyFigureFromPhoto(row.file, {
        onProgress: (p) => {
          row.note = p?.message || 'Identificando…';
        }
      });
      row.name = String(suggestion?.name || '').trim();
      row.manufacturer = String(suggestion?.manufacturer || '').trim();
      row.franchise = String(suggestion?.franchise || '').trim();
      row.series = String(suggestion?.series || '').trim();
      row.character_name = String(suggestion?.character_name || '').trim();
      row.category = String(suggestion?.category || '').trim();
      row.item_number = String(suggestion?.item_number || '').trim();
      row.year = suggestion?.year != null ? String(suggestion.year) : '';
      if (row.name) {
        row.status = 'ready';
        row.note = suggestion?.source === 'gemini' || suggestion?.source === 'gemini-web'
          ? 'Detectado por IA'
          : 'Texto leído de la foto';
      } else {
        row.status = 'error';
        row.note = suggestion?.note || 'Sin nombre — edítalo a mano';
      }
    } catch (err) {
      row.status = 'error';
      row.note = err?.message || 'No se pudo identificar';
    }
  };

  const yieldToUi = () => new Promise((r) => setTimeout(r, 100));

  const withTimeout = (promise, ms, message) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

  const patchRowUi = (row) => {
    const card = listEl?.querySelector(`[data-bulk-id="${row.id}"]`);
    if (!card) {
      paintList();
      return;
    }
    const statusEl = card.querySelector('.bulk-status');
    const noteEl = card.querySelector('.bulk-note');
    if (statusEl) {
      statusEl.className = `bulk-status is-${row.status}`;
      statusEl.textContent = ({
        queued: 'En cola',
        identifying: 'Identificando…',
        ready: 'Lista',
        error: 'Revisar',
        saving: 'Guardando…',
        saved: 'Guardada'
      })[row.status] || row.status;
    }
    if (noteEl) {
      noteEl.textContent = [row.manufacturer, row.series, row.note].filter(Boolean).join(' · ') || '—';
    }
    card.classList.toggle('is-saved', row.status === 'saved');
    card.classList.toggle('is-error', row.status === 'error');
  };

  const saveAll = async () => {
    if (saveRunning) return;
    if (identifyRunning || prepareRunning) {
      toast('Espera a que termine de identificar o recortar', 'info');
      return;
    }
    const targets = rows.filter(
      (r) => (r.status === 'ready' || r.status === 'error') && r.name.trim() && r.file
    );
    if (!targets.length) {
      toast('Nada para guardar: pon un nombre a cada pieza lista', 'info');
      return;
    }
    saveRunning = true;
    setBusy(saveBtn, true, `Guardando 0/${targets.length}…`);
    const collectionIds = readSharedCollectionIds();
    let ok = 0;
    let fail = 0;
    // Una sola pieza a la vez + pausa: N embeddings seguidos colgaban el iPhone.
    const PER_ITEM_MS = 180_000;
    try {
      for (let i = 0; i < targets.length; i++) {
        const row = targets[i];
        const n = i + 1;
        const total = targets.length;
        row.status = 'saving';
        row.note = `${n}/${total}: creando…`;
        patchRowUi(row);
        setProgress(true, `Guardando ${n}/${total}: ${row.name.slice(0, 36)}`);
        if (saveBtn) saveBtn.textContent = `Guardando ${n}/${total}…`;
        await yieldToUi();

        try {
          const item = await withTimeout(
            createItem({
              name: row.name.trim(),
              collection_ids: collectionIds,
              manufacturer: row.manufacturer || null,
              franchise: row.franchise || null,
              series: row.series || null,
              item_number: row.item_number || null,
              character_name: row.character_name || null,
              category: row.category || null,
              year: row.year || null,
              quantity: 1
            }),
            45_000,
            'No se pudo crear la pieza (red)'
          );

          row.note = `${n}/${total}: subiendo foto…`;
          patchRowUi(row);
          await yieldToUi();

          await withTimeout(
            uploadItemImage(item.id, row.file, 'frontal', (p) => {
              const msg = p?.message || p?.stage || 'procesando';
              row.note = `${n}/${total}: ${msg}`;
              patchRowUi(row);
              setProgress(true, `Guardando ${n}/${total}: ${msg}`);
            }),
            PER_ITEM_MS,
            'Tardó demasiado en esta foto. Puedes reintentar solo esa pieza.'
          );

          row.itemId = item.id;
          row.status = 'saved';
          row.note = 'Guardada';
          ok += 1;
          try { URL.revokeObjectURL(row.objectUrl); } catch { /* ignore */ }
          row.objectUrl = '';
          row.file = null;
        } catch (err) {
          console.warn('[bulk] save falló', err);
          row.status = 'error';
          row.note = err?.message || 'Error al guardar';
          fail += 1;
        }
        patchRowUi(row);
        recount();
        // Respirar entre piezas (CLIP/WASM en iPhone)
        await yieldToUi();
        await yieldToUi();
      }
    } finally {
      saveRunning = false;
      setBusy(saveBtn, false);
      setProgress(false);
      paintList();
      recount();
    }

    if (ok && !fail) {
      toast(`${ok} pieza${ok === 1 ? '' : 's'} guardada${ok === 1 ? '' : 's'}`, 'ok');
      navigate('collection', true);
    } else if (ok) {
      toast(`Guardadas ${ok}, fallaron ${fail}. Puedes reintentar las que fallaron.`, 'info');
    } else {
      toast('No se pudo guardar ninguna', 'error');
    }
  };

  camInput?.addEventListener('change', () => {
    const files = takeFilesFromInput(camInput);
    if (files.length) enqueueFiles(files, { offerAnother: true });
    else toast('No se recibió la foto de la cámara', 'info');
  });

  galleryInput?.addEventListener('change', () => {
    const files = takeFilesFromInput(galleryInput);
    if (files.length) enqueueFiles(files, { offerAnother: false });
    else toast('No se recibieron imágenes', 'info');
  });

  anotherBtn?.addEventListener('click', () => openCamera());

  root.querySelector('#bulk-clear')?.addEventListener('click', () => {
    if (!rows.length) return;
    if (!confirm(`¿Vaciar la cola de ${rows.length} foto${rows.length === 1 ? '' : 's'}?`)) return;
    for (const r of rows) {
      try { URL.revokeObjectURL(r.objectUrl); } catch { /* ignore */ }
    }
    rows = [];
    paintList();
    toast('Cola vacía', 'ok');
  });
  saveBtn?.addEventListener('click', () => saveAll());

  root.querySelectorAll('.category-multi').forEach((box) => {
    box.addEventListener('change', (e) => {
      const input = e.target;
      if (input?.name !== 'bulk_collection_ids') return;
      input.closest('.check-chip')?.classList.toggle('is-on', input.checked);
    });
  });
}

function categoryChecks(collections) {
  const list = collections || [];
  if (!list.length) {
    return el('p', {
      className: 'muted small',
      text: 'Sin categorías aún. Puedes crearlas después.'
    });
  }
  return el('fieldset', { className: 'category-multi' }, [
    el('legend', { text: 'Categorías' }),
    el('div', { className: 'category-check-grid' },
      list.map((c) =>
        el('label', { className: 'check-chip' }, [
          el('input', {
            type: 'checkbox',
            name: 'bulk_collection_ids',
            value: c.id
          }),
          el('span', { text: c.name })
        ])
      )
    )
  ]);
}

/**
 * @param {BulkRow} row
 * @param {{ onName: (v:string)=>void, onRemove: ()=>void }} hooks
 */
function rowCard(row, hooks) {
  const statusClass = `bulk-status is-${row.status}`;
  const statusText = ({
    queued: 'En cola',
    identifying: 'Identificando…',
    ready: 'Lista',
    error: 'Revisar',
    saving: 'Guardando…',
    saved: 'Guardada'
  })[row.status] || row.status;

  const nameInput = el('input', {
    className: 'input',
    type: 'text',
    value: row.name,
    placeholder: 'Nombre de la figura…',
    disabled: row.status === 'saved' || row.status === 'saving'
  });
  nameInput.addEventListener('input', () => hooks.onName(nameInput.value));

  return el('article', {
    className: `bulk-card${row.status === 'saved' ? ' is-saved' : ''}${row.status === 'error' ? ' is-error' : ''}`,
    dataset: { bulkId: row.id }
  }, [
    el('div', { className: 'bulk-card-photo' }, [
      row.objectUrl
        ? el('img', { src: row.objectUrl, alt: row.name || 'Foto' })
        : el('span', { className: 'muted small', text: 'OK' })
    ]),
    el('div', { className: 'bulk-card-body' }, [
      el('div', { className: 'bulk-card-top' }, [
        el('span', { className: statusClass, text: statusText }),
        row.status !== 'saved' && row.status !== 'saving'
          ? el('button', {
            type: 'button',
            className: 'btn btn-ghost btn-tiny',
            text: 'Quitar',
            onClick: hooks.onRemove
          })
          : null
      ]),
      nameInput,
      el('p', {
        className: 'muted small bulk-note',
        text: [
          row.manufacturer,
          row.series,
          row.note
        ].filter(Boolean).join(' · ') || '—'
      })
    ])
  ]);
}
