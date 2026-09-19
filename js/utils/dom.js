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

export function compressImage(file, maxSide = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No hay archivo'));
      return;
    }
    // HEIC/HEIF: Safari a veces no pinta en canvas; devolver original
    const type = file.type || '';
    if (type.includes('heic') || type.includes('heif')) {
      resolve(file);
      return;
    }
    if (type && !type.startsWith('image/')) {
      reject(new Error('Archivo no es imagen'));
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
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(new File([blob], (file.name || 'foto').replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Fallback: usar archivo original (p. ej. formatos raros)
      resolve(file);
    };
    img.src = url;
  });
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
