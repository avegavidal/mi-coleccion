export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'html') node.innerHTML = v;
    else if (v === false || v == null) continue;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') node.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'required' || k === 'hidden') {
      node[k] = Boolean(v);
    } else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Abre una tienda fuera de la PWA (Safari en iPhone a veces ignora target=_blank).
 * @param {string} url
 */
export function openExternal(url) {
  const href = String(url || '').trim();
  if (!/^https?:\/\//i.test(href)) return false;
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.assign(href);
  return true;
}

export function toast(message, type = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', className: 'toast-host' });
    document.body.appendChild(host);
  }
  const t = el('div', { className: `toast toast-${type}`, text: message });
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

export function formatMoney(amount, currency = 'USD') {
  if (amount == null || amount === '') return '—';
  try {
    return new Intl.NumberFormat('es', { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

const FX_LS_KEY = 'mi_coleccion_usd_jpy';
/** Fallback si no hay red (se actualiza con frankfurter). */
let usdJpyRate = 149;

export function getUsdJpyRate() {
  return usdJpyRate;
}

export function loadCachedUsdJpyRate() {
  try {
    const raw = globalThis.localStorage?.getItem(FX_LS_KEY);
    if (!raw) return usdJpyRate;
    const data = JSON.parse(raw);
    const rate = Number(data.rate);
    if (rate > 50 && rate < 400) usdJpyRate = rate;
  } catch {
    // ignore
  }
  return usdJpyRate;
}

export async function refreshUsdJpyRate() {
  loadCachedUsdJpyRate();
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=JPY');
    if (!res.ok) return usdJpyRate;
    const data = await res.json();
    const rate = Number(data?.rates?.JPY);
    if (rate > 50 && rate < 400) {
      usdJpyRate = rate;
      try {
        globalThis.localStorage?.setItem(FX_LS_KEY, JSON.stringify({ rate, at: Date.now() }));
      } catch { /* ignore */ }
    }
  } catch {
    // se queda el cache o el fallback
  }
  return usdJpyRate;
}

/**
 * Precio en USD y JPY para comparar ambos mercados.
 * @param {number|string} amount
 * @param {string} [currency]
 */
export function formatMoneyDual(amount, currency = 'USD') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const cur = String(currency || 'USD').toUpperCase();
  const rate = getUsdJpyRate();
  let usd;
  let jpy;
  if (cur === 'JPY' || cur === 'YEN') {
    jpy = n;
    usd = n / rate;
  } else if (cur === 'USD') {
    usd = n;
    jpy = n * rate;
  } else {
    return formatMoney(n, cur);
  }
  const yen = Math.round(jpy);
  return `${formatMoney(usd, 'USD')} · ${formatMoney(yen, 'JPY')}`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function imageTypeLabel(type) {
  const map = {
    frontal: 'Frontal',
    trasera: 'Trasera',
    lateral: 'Lateral',
    caja: 'Caja',
    codigo: 'Código',
    etiqueta: 'Etiqueta',
    additional: 'Adicional'
  };
  return map[type] || type || 'Foto';
}

export function compressImage(file, maxSide = 1024, quality = 0.72, preferMime = 'image/webp') {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No hay archivo'));
      return;
    }
    const type = file.type || '';
    if (type.includes('heic') || type.includes('heif')) {
      resolve(file);
      return;
    }
    if (type && !type.startsWith('image/')) {
      reject(new Error('Archivo no es imagen'));
      return;
    }
    // Ya es pequeña: no re-encode (ahorra tiempo al listar/re-subir)
    if (file.size && file.size < 90_000 && type.startsWith('image/') && !type.includes('png')) {
      resolve(file);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;
      if (!w || !h) {
        URL.revokeObjectURL(url);
        resolve(file);
        return;
      }
      const scale = Math.min(1, maxSide / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(img, 0, 0, w, h);

      const finish = (blob, mime, ext) => {
        URL.revokeObjectURL(url);
        if (!blob) {
          resolve(file);
          return;
        }
        // Si el resultado salió más grande, queda el original
        if (blob.size >= file.size * 0.98 && file.size < 400_000) {
          resolve(file);
          return;
        }
        const base = String(file.name || 'foto').replace(/\.\w+$/, '');
        resolve(new File([blob], `${base}.${ext}`, { type: mime }));
      };

      const tryWebp = preferMime === 'image/webp'
        && typeof canvas.toBlob === 'function';

      if (tryWebp) {
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size > 0 && blob.type === 'image/webp') {
              finish(blob, 'image/webp', 'webp');
            } else {
              canvas.toBlob(
                (b2) => finish(b2, 'image/jpeg', 'jpg'),
                'image/jpeg',
                quality
              );
            }
          },
          'image/webp',
          quality
        );
      } else {
        canvas.toBlob(
          (blob) => finish(blob, 'image/jpeg', 'jpg'),
          'image/jpeg',
          quality
        );
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

/** Foto completa para almacenamiento / CLIP (~≤150–250 KB típico). */
export function compressImageUpload(file) {
  return compressImage(file, 1024, 0.72, 'image/webp');
}

/** Miniatura para grids / dashboard (~≤25–40 KB). */
export function compressImageThumb(file) {
  return compressImage(file, 360, 0.55, 'image/webp');
}

export function setBusy(button, busy, label) {
  if (!button || typeof button !== 'object' || !('disabled' in button)) return;
  if (busy) {
    button.dataset.prevText = button.textContent;
    button.disabled = true;
    button.textContent = label || 'Espera…';
  } else {
    button.disabled = false;
    button.textContent = button.dataset.prevText || button.textContent;
  }
}

/**
 * Barra de progreso indeterminada en el panel de precio de mercado.
 * @param {HTMLElement|null} progressEl  .market-search-progress
 * @param {boolean} searching
 * @param {HTMLElement|null} [panelEl]   .market-panel (opcional, para pulso)
 */
export function setMarketSearching(progressEl, searching, panelEl = null) {
  if (progressEl) {
    progressEl.classList.toggle('is-active', Boolean(searching));
    progressEl.setAttribute('aria-hidden', searching ? 'false' : 'true');
    if (searching) progressEl.setAttribute('aria-busy', 'true');
    else progressEl.removeAttribute('aria-busy');
  }
  if (panelEl) panelEl.classList.toggle('is-market-searching', Boolean(searching));
}

export function emptyState(title, subtitle = '', cta = null) {
  const box = el('div', { className: 'empty-state' }, [
    el('div', { className: 'empty-visual', html: '<span></span><span></span><span></span>' }),
    el('h3', { text: title }),
    subtitle ? el('p', { text: subtitle }) : null
  ]);
  if (cta) box.append(cta);
  return box;
}

export function skeletonGrid(count = 4) {
  const wrap = el('div', { className: 'card-grid' });
  for (let i = 0; i < count; i++) {
    wrap.append(el('div', { className: 'item-card skeleton-card', html: '<div class="sk-media"></div><div class="sk-line"></div><div class="sk-line short"></div>' }));
  }
  return wrap;
}
