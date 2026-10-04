const STORAGE_KEY = 'mi_coleccion_theme_v1';
const THEME_COLORS = {
  light: '#e8f0f2',
  dark: '#0c1218'
};

/**
 * @returns {'system'|'light'|'dark'}
 */
export function getThemePreference() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'system';
}

/**
 * @param {'system'|'light'|'dark'} pref
 */
export function setThemePreference(pref) {
  const next = pref === 'light' || pref === 'dark' ? pref : 'system';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  applyTheme();
  return next;
}

/**
 * @param {'system'|'light'|'dark'} [pref]
 * @returns {'light'|'dark'}
 */
export function resolveTheme(pref = getThemePreference()) {
  if (pref === 'light' || pref === 'dark') return pref;
  try {
    return globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function setMetaThemeColor(resolved) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[resolved] || THEME_COLORS.light);
}

let mediaBound = false;

/**
 * Aplica el tema resuelto a <html data-theme="light|dark">.
 */
export function applyTheme() {
  const pref = getThemePreference();
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePref = pref;
  setMetaThemeColor(resolved);

  if (!mediaBound && typeof matchMedia === 'function') {
    mediaBound = true;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (getThemePreference() === 'system') applyTheme();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  return resolved;
}
