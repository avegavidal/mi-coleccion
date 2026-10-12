/**
 * Detecta versión nueva en el servidor y ofrece actualizar o seguir.
 */
import { el, forceAppUpdate } from './dom.js';

const SKIP_KEY = 'mi_coleccion_skip_update';

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} >0 si a>b, <0 si a<b, 0 igual
 */
export function compareVersions(a, b) {
  const pa = String(a || '').split(/[^\d]+/).filter(Boolean).map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split(/[^\d]+/).filter(Boolean).map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Lee la versión publicada (siempre desde red).
 * @returns {Promise<string|null>}
 */
export async function fetchRemoteAppVersion() {
  const url = new URL('./version.json', location.href);
  url.searchParams.set('_', String(Date.now()));
  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) return null;
  const data = await res.json();
  const v = String(data?.version || '').trim();
  return v || null;
}

/**
 * Al entrar: si hay versión más nueva, muestra popup.
 * @returns {Promise<boolean>} true si se mostró el popup
 */
export async function promptIfAppUpdateAvailable() {
  // Evitar duplicar el popup inline de index.html
  if (document.getElementById('app-update-modal')) return false;
  const bootModal = document.getElementById('boot-update-modal');
  if (bootModal?.classList.contains('show') || window.__bootUpdateShown) return false;

  const local = String(window.APP_CONFIG?.APP_VERSION || '').trim();
  if (!local || !navigator.onLine) return false;

  let remote = null;
  try {
    remote = await fetchRemoteAppVersion();
  } catch (err) {
    console.warn('[update] no se pudo leer version.json', err);
    return false;
  }
  if (!remote) return false;
  if (compareVersions(remote, local) <= 0) return false;

  try {
    if (sessionStorage.getItem(SKIP_KEY) === remote) return false;
  } catch { /* ignore */ }

  showUpdateModal({ local, remote });
  return true;
}

/**
 * @param {{ local: string, remote: string }} versions
 */
export function showUpdateModal({ local, remote }) {
  document.getElementById('app-update-modal')?.remove();

  const overlay = el('div', {
    id: 'app-update-modal',
    className: 'app-update-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'app-update-title'
  }, [
    el('div', { className: 'app-update-card' }, [
      el('h2', { id: 'app-update-title', text: 'Nueva versión disponible' }),
      el('p', {
        className: 'app-update-body',
        text: `Hay una versión más reciente (${remote}). Estás en ${local}.`
      }),
      el('p', {
        className: 'muted small',
        text: 'Puedes actualizar ahora o seguir con esta versión por ahora.'
      }),
      el('div', { className: 'app-update-actions' }, [
        el('button', {
          type: 'button',
          className: 'btn btn-ghost',
          id: 'app-update-later',
          text: 'Seguir con esta'
        }),
        el('button', {
          type: 'button',
          className: 'btn btn-primary',
          id: 'app-update-now',
          text: 'Actualizar'
        })
      ])
    ])
  ]);

  const close = (skip) => {
    if (skip) {
      try { sessionStorage.setItem(SKIP_KEY, remote); } catch { /* ignore */ }
    }
    overlay.remove();
  };

  overlay.querySelector('#app-update-later')?.addEventListener('click', () => close(true));
  overlay.querySelector('#app-update-now')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('#app-update-now');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Actualizando…';
    }
    try { sessionStorage.removeItem(SKIP_KEY); } catch { /* ignore */ }
    await forceAppUpdate({ hard: true });
  });

  document.body.append(overlay);
}
