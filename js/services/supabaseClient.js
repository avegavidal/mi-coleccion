/**
 * Cliente Supabase compartido.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

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
      storage: window.localStorage
    }
  }
);

export function getConfig() {
  return window.APP_CONFIG;
}
