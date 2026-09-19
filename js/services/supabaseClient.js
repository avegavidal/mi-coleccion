/**
 * Cliente Supabase compartido.
 * Passkeys requieren @supabase/supabase-js >= 2.105 y auth.experimental.passkey.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0/+esm';

const cfg = window.APP_CONFIG;

if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('TU-PROYECTO')) {
  console.warn('[Mi Colección] Configura js/config.js con tu URL y anon key de Supabase.');
}

export const supabase = createClient(
  cfg?.SUPABASE_URL || 'https://placeholder.supabase.co',
  cfg?.SUPABASE_ANON_KEY || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      experimental: {
        passkey: true
      }
    }
  }
);

export function getConfig() {
  return window.APP_CONFIG;
}

/** Origen de la app (GitHub Pages) para OAuth / recovery redirects */
export function appRedirectUrl() {
  const path = window.location.pathname.replace(/\/index\.html$/, '/');
  return `${window.location.origin}${path.endsWith('/') ? path : `${path}/`}`;
}
