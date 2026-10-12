import { defineRoute, startRouter, setAuthUser, navigate, getAuthUser } from './utils/router.js';
import { onAuthStateChange, getSession, signOut } from './services/authService.js';
import { refreshUsdJpyRate, continueAppUpdateIfNeeded } from './utils/dom.js';
import { promptIfAppUpdateAvailable } from './utils/appUpdate.js';
import { applyTheme } from './utils/theme.js';
import { renderLogin, renderRecover } from './screens/auth.js';

// 2º pase de actualización iPhone (si el primero dejó HTML viejo en caché HTTP)
if (continueAppUpdateIfNeeded()) {
  /* recarga en curso */
}
import { renderDashboard } from './screens/dashboard.js';
import {
  renderCollection, renderAdd, renderItemDetail, renderEdit,
  renderDuplicates
} from './screens/collection.js';
import { renderAddBulk } from './screens/addBulk.js';
import { renderCollectionsManage, renderCategoryDetail } from './screens/categories.js';
import { renderIdentify, renderCompare } from './screens/identify.js';
import { renderWishlist, renderStats, renderAccount, renderSettings } from './screens/wishlist.js';

applyTheme();

defineRoute('login', renderLogin, { public: true });
defineRoute('recover', renderRecover, { public: true });
defineRoute('dashboard', renderDashboard);
defineRoute('collection', renderCollection);
defineRoute('add', renderAdd);
defineRoute('add-bulk', renderAddBulk);
defineRoute('item', renderItemDetail);
defineRoute('edit', renderEdit);
defineRoute('collections', renderCollectionsManage);
defineRoute('category', renderCategoryDetail);
defineRoute('duplicates', renderDuplicates);
defineRoute('identify', renderIdentify);
defineRoute('compare', renderCompare);
defineRoute('wishlist', renderWishlist);
defineRoute('stats', renderStats);
defineRoute('account', renderAccount);
defineRoute('settings', renderSettings);

function updateChrome(routeName, isAuthed) {
  const app = document.getElementById('app');
  const nav = document.getElementById('bottom-nav');
  const top = document.getElementById('top-bar');
  const offline = document.getElementById('offline-banner');

  if (!isAuthed) {
    app?.classList.add('auth-mode');
    nav?.classList.add('hidden');
    top?.classList.add('hidden');
  } else {
    app?.classList.remove('auth-mode');
    nav?.classList.remove('hidden');
    top?.classList.remove('hidden');
  }

  document.querySelectorAll('#bottom-nav a').forEach((a) => {
    const r = a.dataset.route;
    a.classList.toggle('active', r === routeName || (routeName === 'item' && r === 'collection') || (routeName === 'compare' && r === 'identify') || ((routeName === 'collections' || routeName === 'category') && r === 'collection'));
  });

  if (offline) {
    offline.classList.toggle('hidden', navigator.onLine);
  }
}

async function boot() {
  const session = await getSession();
  setAuthUser(session?.user || null);

  const cfgWarn = document.getElementById('config-warning');
  const cfg = window.APP_CONFIG;
  if (!cfg || cfg.SUPABASE_URL.includes('TU-PROYECTO') || cfg.SUPABASE_ANON_KEY.includes('TU_ANON')) {
    cfgWarn?.classList.remove('hidden');
  }

  let lastUid = session?.user?.id || null;

  onAuthStateChange((event, nextSession) => {
    const uid = nextSession?.user?.id || null;
    setAuthUser(nextSession?.user || null);

    // Evitar bucles: solo reaccionar a cambios reales de sesión
    if (event === 'INITIAL_SESSION') return;
    if (uid === lastUid && event !== 'SIGNED_OUT' && event !== 'SIGNED_IN') return;
    lastUid = uid;

    const raw = (location.hash || '#/').replace(/^#\/?/, '');
    const name = raw.split('/')[0] || 'dashboard';
    if (!uid && !['login', 'recover'].includes(name)) {
      navigate('login', true);
      return;
    }
    if (uid && ['login', 'register', 'recover', ''].includes(name)) {
      navigate('dashboard', true);
      return;
    }
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  document.getElementById('btn-logout-top')?.addEventListener('click', async () => {
    await signOut();
    navigate('login', true);
  });

  window.addEventListener('online', () => updateChrome(location.hash, !!getAuthUser()));
  window.addEventListener('offline', () => updateChrome(location.hash, !!getAuthUser()));

  await startRouter(document.getElementById('view'), {
    onNavigate: updateChrome
  });

  refreshUsdJpyRate().catch(() => {});

  // Al entrar: avisar si el servidor tiene una versión más nueva (sin forzar).
  promptIfAppUpdateAvailable().catch(() => {});

  if ('serviceWorker' in navigator) {
    try {
      const swVer = String(window.APP_CONFIG?.APP_VERSION || '1.6.29').replace(/\W/g, '');
      const reg = await navigator.serviceWorker.register(`./service-worker.js?v=${swVer}`);
      await reg.update();
      // No activar/recargar solo: el usuario elige en el popup de versión.
      if (reg.waiting) {
        promptIfAppUpdateAvailable().catch(() => {});
      }
    } catch (err) {
      console.warn('SW no registrado', err);
    }
  }
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('view').innerHTML = `<div class="error-box"><h2>Error al iniciar</h2><p>${err.message}</p></div>`;
});
