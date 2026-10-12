/**
 * Alta masiva de figuras: varias fotos → IA rellena nombre → guardar todas.
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
        text: 'Abre la cámara y dispara todas las que quieras, o elige varias de la galería. La IA nombra cada una.'
      })
    ]),
    el('div', { className: 'bulk-toolbar' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        id: 'bulk-open-cam',
        text: '📷 Cámara (varias)'
      }),
      el('label', {
        className: 'btn btn-ghost',
        html: 'Galería<input type="file" accept="image/*" multiple id="bulk-gallery" hidden>'
      }),
      el('input', {
        type: 'file',
        accept: 'image/*',
        capture: 'environment',
        id: 'bulk-cam-fallback',
        hidden: true
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

  const listEl = root.querySelector('#bulk-list');
  const statusEl = root.querySelector('#bulk-status');
  const progressEl = root.querySelector('#bulk-progress');
  const progressLabel = root.querySelector('#bulk-progress-label');
  const sharedEl = root.querySelector('#bulk-shared');
  const actionsEl = root.querySelector('#bulk-actions');
  const saveBtn = root.querySelector('#bulk-save');

  const readSharedCollectionIds = () =>
    [...root.querySelectorAll('input[name="bulk_collection_ids"]:checked')].map((i) => i.value);

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
    saveBtn.disabled = saveRunning || !toSave;
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

  const enqueueFiles = async (fileList) => {
    const files = [...(fileList || [])].filter((f) => f && f.type?.startsWith('image/'));
    if (!files.length) {
      toast('No hay imágenes en la selección', 'info');
      return;
    }

    setProgress(true, `Preparando ${files.length} foto${files.length === 1 ? '' : 's'}…`);
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(true, `Preparando ${i + 1}/${files.length}…`);
      try {
        const prepared = await prepareImageForAnalysis(file, {
          skipCrop: true,
          cropTitle: 'Recortar figura'
        });
        if (!prepared) continue;
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
        added += 1;
      } catch (err) {
        console.warn('[bulk] prepare falló', err);
      }
    }
    setProgress(false);
    paintList();
    if (!added) {
      toast('No se pudo preparar ninguna foto', 'error');
      return;
    }
    toast(`${added} foto${added === 1 ? '' : 's'} en cola`, 'ok');
    runIdentifyQueue();
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
      setProgress(false);
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

  const saveAll = async () => {
    if (saveRunning) return;
    const targets = rows.filter((r) => r.status !== 'saved' && r.name.trim() && r.file);
    if (!targets.length) {
      toast('Nada para guardar: pon un nombre a cada pieza', 'info');
      return;
    }
    saveRunning = true;
    setBusy(saveBtn, true, 'Guardando…');
    const collectionIds = readSharedCollectionIds();
    let ok = 0;
    let fail = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const row = targets[i];
        row.status = 'saving';
        row.note = `Guardando ${i + 1}/${targets.length}…`;
        paintList();
        setProgress(true, `Guardando ${i + 1}/${targets.length}: ${row.name.slice(0, 40)}`);
        try {
          const item = await createItem({
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
          });
          await uploadItemImage(item.id, row.file, 'frontal', () => {});
          row.itemId = item.id;
          row.status = 'saved';
          row.note = 'Guardada';
          ok += 1;
        } catch (err) {
          row.status = 'error';
          row.note = err?.message || 'Error al guardar';
          fail += 1;
        }
        paintList();
      }
    } finally {
      saveRunning = false;
      setBusy(saveBtn, false);
      setProgress(false);
      recount();
    }

    if (ok && !fail) {
      toast(`${ok} pieza${ok === 1 ? '' : 's'} guardada${ok === 1 ? '' : 's'}`, 'ok');
      navigate('collection', true);
    } else if (ok) {
      toast(`Guardadas ${ok}, fallaron ${fail}`, 'info');
    } else {
      toast('No se pudo guardar ninguna', 'error');
    }
  };

  root.querySelector('#bulk-gallery')?.addEventListener('change', (e) => {
    const files = e.target.files;
    e.target.value = '';
    if (files?.length) enqueueFiles(files);
  });

  const camFallback = root.querySelector('#bulk-cam-fallback');
  /** Tras cada captura nativa, reabre la cámara hasta que el usuario cancele. */
  let nativeCamLoop = false;
  camFallback?.addEventListener('change', (e) => {
    const files = e.target.files;
    e.target.value = '';
    if (files?.length) {
      enqueueFiles(files);
      if (nativeCamLoop) {
        setTimeout(() => camFallback.click(), 280);
      }
    } else {
      nativeCamLoop = false;
    }
  });

  root.querySelector('#bulk-open-cam')?.addEventListener('click', async () => {
    const ok = await openMultiShotCamera({
      onCapture: (file) => {
        enqueueFiles([file]);
      }
    });
    if (!ok && camFallback) {
      nativeCamLoop = true;
      toast('Dispara una tras otra; cancela en la cámara cuando termines', 'info');
      camFallback.click();
    }
  });

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
 * Cámara en vivo: misma sesión, varias capturas.
 * @param {{ onCapture: (file: File)=>void }} opts
 * @returns {Promise<boolean>} true si abrió getUserMedia
 */
async function openMultiShotCamera(opts) {
  if (!navigator.mediaDevices?.getUserMedia) return false;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1440 }
      }
    });
  } catch (err) {
    console.warn('[bulk-cam] getUserMedia falló', err);
    return false;
  }

  return new Promise((resolve) => {
    let shotCount = 0;
    let shutterLock = false;
    let closed = false;

    const video = el('video', {
      className: 'bulk-cam-video',
      autoplay: true,
      playsinline: true,
      muted: true
    });
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.srcObject = stream;

    const countEl = el('span', { className: 'bulk-cam-count', text: '0 capturas' });
    const flashEl = el('div', { className: 'bulk-cam-flash', hidden: true });

    const stop = () => {
      if (closed) return;
      closed = true;
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch { /* ignore */ }
      video.srcObject = null;
      overlay.remove();
      document.body.classList.remove('bulk-cam-open');
      resolve(true);
    };

    const captureFrame = async () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) throw new Error('Cámara aún no lista');
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise((res, rej) => {
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error('No se pudo capturar'))),
          'image/jpeg',
          0.92
        );
      });
      return new File([blob], `cam_${Date.now()}.jpg`, { type: 'image/jpeg' });
    };

    const onShutter = async () => {
      if (shutterLock || closed) return;
      shutterLock = true;
      try {
        const file = await captureFrame();
        shotCount += 1;
        countEl.textContent = `${shotCount} captura${shotCount === 1 ? '' : 's'}`;
        flashEl.hidden = false;
        requestAnimationFrame(() => {
          setTimeout(() => { flashEl.hidden = true; }, 90);
        });
        opts.onCapture?.(file);
      } catch (err) {
        toast(err?.message || 'No se pudo capturar', 'error');
      } finally {
        setTimeout(() => { shutterLock = false; }, 160);
      }
    };

    const overlay = el('div', {
      className: 'bulk-cam-overlay',
      role: 'dialog',
      'aria-label': 'Cámara para varias figuras'
    }, [
      el('header', { className: 'bulk-cam-header' }, [
        el('p', { className: 'bulk-cam-title', text: 'Apunta y dispara' }),
        countEl,
        el('button', {
          type: 'button',
          className: 'btn btn-ghost bulk-cam-done',
          text: 'Listo',
          onClick: stop
        })
      ]),
      el('div', { className: 'bulk-cam-stage' }, [video, flashEl]),
      el('div', { className: 'bulk-cam-controls' }, [
        el('p', {
          className: 'muted small bulk-cam-hint',
          text: 'Cada disparo se agrega al lote. Sigue hasta terminar.'
        }),
        el('button', {
          type: 'button',
          className: 'bulk-cam-shutter',
          'aria-label': 'Capturar',
          onClick: onShutter
        })
      ])
    ]);

    document.body.classList.add('bulk-cam-open');
    document.body.append(overlay);
    video.play?.().catch(() => {});
  });
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
    className: `bulk-card${row.status === 'saved' ? ' is-saved' : ''}${row.status === 'error' ? ' is-error' : ''}`
  }, [
    el('div', { className: 'bulk-card-photo' }, [
      el('img', { src: row.objectUrl, alt: row.name || 'Foto' })
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
        className: 'muted small',
        text: [
          row.manufacturer,
          row.series,
          row.note
        ].filter(Boolean).join(' · ') || '—'
      })
    ])
  ]);
}
