/**
 * Router hash-based compatible con GitHub Pages.
 * Rutas privadas requieren sesión.
 */
const routes = new Map();
let currentUser = null;
let renderRoot = null;
let onNavigate = null;

const PUBLIC = new Set(['login', 'register', 'recover']);

export function defineRoute(name, handler, { public: isPublic = false } = {}) {
  routes.set(name, { handler, public: isPublic });
  if (isPublic) PUBLIC.add(name);
}

export function setAuthUser(user) {
  currentUser = user;
}

export function getAuthUser() {
  return currentUser;
}

export function navigate(path, replace = false) {
  const hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
  if (replace) location.replace(hash);
  else location.hash = hash;
}

export function getRoute() {
  const raw = (location.hash || '#/').replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/').filter(Boolean);
  return { name: name || 'dashboard', params: rest };
}

export async function startRouter(root, hooks = {}) {
  renderRoot = root;
  onNavigate = hooks.onNavigate;

  const go = async () => {
    const { name, params } = getRoute();
    const route = routes.get(name) || routes.get('dashboard');
    const isPublic = route?.public || PUBLIC.has(name);

    if (!currentUser && !isPublic) {
      navigate('login', true);
      return;
    }
    if (currentUser && (name === 'login' || name === 'register' || name === 'recover' || !name)) {
      if (name === 'login' || name === 'register' || name === 'recover') {
        navigate('dashboard', true);
        return;
      }
    }

    if (onNavigate) onNavigate(name, !!currentUser);

    renderRoot.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'screen';
    renderRoot.appendChild(shell);

    try {
      await route.handler(shell, params);
    } catch (err) {
      console.error(err);
      shell.innerHTML = `<div class="error-box"><h2>Error</h2><p>${err.message || err}</p></div>`;
    }

    window.scrollTo(0, 0);
  };

  window.addEventListener('hashchange', go);
  await go();
}
