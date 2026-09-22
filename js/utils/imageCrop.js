/**
 * Recorte de imagen (puro + UI) para reducir ruido antes de CLIP/OCR/IA.
 */

import { el } from './dom.js';

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

/**
 * Rectángulo centrado (~ratio del lado menor).
 * @param {number} imgW
 * @param {number} imgH
 * @param {number} [ratio=0.72]
 * @returns {Rect}
 */
export function defaultCenterCrop(imgW, imgH, ratio = 0.72) {
  const w0 = Math.max(1, Number(imgW) || 1);
  const h0 = Math.max(1, Number(imgH) || 1);
  const side = Math.min(w0, h0) * Math.min(1, Math.max(0.2, ratio));
  const w = Math.min(w0, side);
  const h = Math.min(h0, side);
  return clampRect(
    { x: (w0 - w) / 2, y: (h0 - h) / 2, w, h },
    { w: w0, h: h0 },
    48
  );
}

/**
 * @param {Rect} rect
 * @param {{ w: number, h: number }} bounds
 * @param {number} [minSide=32]
 * @returns {Rect}
 */
export function clampRect(rect, bounds, minSide = 32) {
  const bw = Math.max(1, bounds.w);
  const bh = Math.max(1, bounds.h);
  let w = Math.max(minSide, Math.min(bw, Number(rect.w) || minSide));
  let h = Math.max(minSide, Math.min(bh, Number(rect.h) || minSide));
  let x = Number(rect.x) || 0;
  let y = Number(rect.y) || 0;
  x = Math.max(0, Math.min(bw - w, x));
  y = Math.max(0, Math.min(bh - h, y));
  // Redondeo estable para tests / canvas
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h)
  };
}

/**
 * Layout object-fit: contain.
 * @param {number} natW
 * @param {number} natH
 * @param {number} boxW
 * @param {number} boxH
 */
export function containLayout(natW, natH, boxW, boxH) {
  const nw = Math.max(1, natW);
  const nh = Math.max(1, natH);
  const bw = Math.max(1, boxW);
  const bh = Math.max(1, boxH);
  const scale = Math.min(bw / nw, bh / nh);
  const w = nw * scale;
  const h = nh * scale;
  return {
    scale,
    left: (bw - w) / 2,
    top: (bh - h) / 2,
    w,
    h
  };
}

/**
 * Convierte rect en coords del viewport → coords naturales de la imagen.
 * @param {Rect} displayRect  relativo al viewport del stage
 * @param {{ scale: number, left: number, top: number }} layout
 * @param {{ w: number, h: number }} natural
 * @param {number} [minSide=32]
 */
export function displayRectToNatural(displayRect, layout, natural, minSide = 32) {
  const scale = layout.scale || 1;
  const x = (displayRect.x - layout.left) / scale;
  const y = (displayRect.y - layout.top) / scale;
  const w = displayRect.w / scale;
  const h = displayRect.h / scale;
  return clampRect({ x, y, w, h }, natural, minSide);
}

/**
 * @param {Rect} naturalRect
 * @param {{ scale: number, left: number, top: number }} layout
 */
export function naturalRectToDisplay(naturalRect, layout) {
  return {
    x: layout.left + naturalRect.x * layout.scale,
    y: layout.top + naturalRect.y * layout.scale,
    w: naturalRect.w * layout.scale,
    h: naturalRect.h * layout.scale
  };
}

/**
 * Recorta un HTMLImageElement / ImageBitmap a un File JPEG.
 * @param {CanvasImageSource} source
 * @param {Rect} rect  coords naturales
 * @param {{ name?: string, quality?: number, maxSide?: number }} [opts]
 * @returns {Promise<File>}
 */
export function cropImageSourceToFile(source, rect, opts = {}) {
  const quality = opts.quality ?? 0.9;
  const maxSide = opts.maxSide ?? 1280;
  const name = (opts.name || 'foto-recorte.jpg').replace(/\.\w+$/, '.jpg');
  const sx = Math.max(0, Math.round(rect.x));
  const sy = Math.max(0, Math.round(rect.y));
  const sw = Math.max(1, Math.round(rect.w));
  const sh = Math.max(1, Math.round(rect.h));

  let dw = sw;
  let dh = sh;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  dw = Math.max(1, Math.round(sw * scale));
  dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('No se pudo recortar la imagen'));
          return;
        }
        resolve(new File([blob], name, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Abre UI de recorte. Resuelve con File recortado, el original (foto completa), o null (cancelar).
 * @param {Blob|File} file
 * @param {{ title?: string }} [options]
 * @returns {Promise<File|Blob|null>}
 */
export function openImageCropper(file, options = {}) {
  return new Promise((resolve) => {
    if (!file) {
      resolve(null);
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      overlay.remove();
      document.body.classList.remove('cropper-open');
      resolve(result);
    };

    const overlay = el('div', {
      className: 'cropper-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.title || 'Recortar foto'
    });

    const stage = el('div', { className: 'cropper-stage' });
    const imgEl = el('img', { className: 'cropper-img', alt: 'Foto a recortar', draggable: 'false' });
    imgEl.src = url;
    const shade = el('div', { className: 'cropper-shade', 'aria-hidden': 'true' });
    const box = el('div', { className: 'cropper-box', tabindex: '0' });
    for (const h of ['nw', 'ne', 'sw', 'se']) {
      box.append(el('span', { className: `cropper-handle cropper-handle-${h}`, dataset: { handle: h } }));
    }

    stage.append(imgEl, shade, box);

    const toolbar = el('div', { className: 'cropper-toolbar' }, [
      el('p', {
        className: 'cropper-hint',
        text: 'Arrastra el recuadro para centrar solo la figura. Pellizca/ajusta las esquinas.'
      }),
      el('div', { className: 'cropper-actions' }, [
        el('button', { type: 'button', className: 'btn btn-ghost', id: 'crop-cancel', text: 'Cancelar' }),
        el('button', { type: 'button', className: 'btn btn-ghost', id: 'crop-full', text: 'Foto completa' }),
        el('button', { type: 'button', className: 'btn btn-primary', id: 'crop-use', text: 'Usar recorte' })
      ])
    ]);

    overlay.append(
      el('header', { className: 'cropper-header' }, [
        el('h2', { text: options.title || 'Recortar' }),
        el('p', { className: 'muted small', text: 'Quita el fondo que genera ruido' })
      ]),
      stage,
      toolbar
    );

    document.body.classList.add('cropper-open');
    document.body.append(overlay);

    /** @type {Rect} */
    let naturalRect = { x: 0, y: 0, w: 1, h: 1 };
    let layout = { scale: 1, left: 0, top: 0, w: 1, h: 1 };
    let natW = 1;
    let natH = 1;

    const paintBox = () => {
      const d = naturalRectToDisplay(naturalRect, layout);
      box.style.transform = `translate(${d.x}px, ${d.y}px)`;
      box.style.width = `${d.w}px`;
      box.style.height = `${d.h}px`;
      // shade via box-shadow trick on cropper-box
      box.style.boxShadow = `0 0 0 9999px rgba(0,0,0,0.55)`;
    };

    const measure = () => {
      const rect = stage.getBoundingClientRect();
      layout = containLayout(natW, natH, rect.width, rect.height);
      imgEl.style.width = `${layout.w}px`;
      imgEl.style.height = `${layout.h}px`;
      imgEl.style.left = `${layout.left}px`;
      imgEl.style.top = `${layout.top}px`;
      naturalRect = clampRect(naturalRect, { w: natW, h: natH }, Math.min(48, natW, natH));
      paintBox();
    };

    img.onload = () => {
      natW = img.naturalWidth || 1;
      natH = img.naturalHeight || 1;
      naturalRect = defaultCenterCrop(natW, natH, 0.7);
      measure();
    };
    img.onerror = () => finish(file);
    img.src = url;

    // Also when imgEl loads (same url)
    imgEl.onload = () => {
      if (!img.complete) return;
      natW = imgEl.naturalWidth || natW;
      natH = imgEl.naturalHeight || natH;
      if (naturalRect.w <= 1) naturalRect = defaultCenterCrop(natW, natH, 0.7);
      measure();
    };

    window.addEventListener('resize', measure);

    /** @type {{ mode: 'move'|'resize', handle?: string, startX: number, startY: number, startRect: Rect } | null} */
    let drag = null;

    const pointerPos = (e) => {
      const r = stage.getBoundingClientRect();
      const t = e.touches?.[0] || e.changedTouches?.[0] || e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };

    const onStart = (e) => {
      const handle = e.target?.dataset?.handle;
      const p = pointerPos(e);
      drag = {
        mode: handle ? 'resize' : 'move',
        handle,
        startX: p.x,
        startY: p.y,
        startRect: { ...naturalRect }
      };
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!drag) return;
      e.preventDefault();
      const p = pointerPos(e);
      const dx = (p.x - drag.startX) / layout.scale;
      const dy = (p.y - drag.startY) / layout.scale;
      const s = drag.startRect;
      let next = { ...s };

      if (drag.mode === 'move') {
        next = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h };
      } else {
        const h = drag.handle;
        if (h.includes('w')) {
          next.x = s.x + dx;
          next.w = s.w - dx;
        }
        if (h.includes('e')) next.w = s.w + dx;
        if (h.includes('n')) {
          next.y = s.y + dy;
          next.h = s.h - dy;
        }
        if (h.includes('s')) next.h = s.h + dy;
      }
      naturalRect = clampRect(next, { w: natW, h: natH }, Math.min(64, natW, natH));
      paintBox();
    };

    const onEnd = () => {
      drag = null;
    };

    box.addEventListener('pointerdown', onStart);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onEnd);
    stage.addEventListener('pointercancel', onEnd);
    box.addEventListener('touchstart', onStart, { passive: false });
    stage.addEventListener('touchmove', onMove, { passive: false });
    stage.addEventListener('touchend', onEnd);

    overlay.querySelector('#crop-cancel').addEventListener('click', () => {
      window.removeEventListener('resize', measure);
      finish(null);
    });
    overlay.querySelector('#crop-full').addEventListener('click', () => {
      window.removeEventListener('resize', measure);
      finish(file instanceof File ? file : new File([file], 'foto.jpg', { type: file.type || 'image/jpeg' }));
    });
    overlay.querySelector('#crop-use').addEventListener('click', async () => {
      try {
        const out = await cropImageSourceToFile(img, naturalRect, {
          name: file.name || 'foto-recorte.jpg'
        });
        window.removeEventListener('resize', measure);
        finish(out);
      } catch (err) {
        window.removeEventListener('resize', measure);
        finish(file);
      }
    });
  });
}

/**
 * Flujo estándar: recortar (opcional) y luego comprimir.
 * @param {File|Blob} file
 * @param {{ skipCrop?: boolean, cropTitle?: string }} [opts]
 * @returns {Promise<File|null>}
 */
export async function prepareImageForAnalysis(file, opts = {}) {
  if (!file) return null;
  let working = file;
  if (!opts.skipCrop) {
    const cropped = await openImageCropper(file, { title: opts.cropTitle || 'Recortar para analizar' });
    if (cropped == null) return null; // cancelado
    working = cropped;
  }
  const { compressImageUpload } = await import('./dom.js');
  return compressImageUpload(working);
}
