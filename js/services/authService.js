import { supabase, appRedirectUrl } from './supabaseClient.js';

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (error) throw error;
  return data;
}

/** Google OAuth (SSO). Requiere provider Google activo en Supabase Auth. */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: appRedirectUrl(),
      queryParams: { prompt: 'select_account' }
    }
  });
  if (error) throw error;
  return data;
}

/**
 * Passkey / Face ID (WebAuthn).
 * Requiere Passkeys habilitados en Supabase y un passkey registrado en la cuenta.
 */
export async function signInWithPasskey() {
  if (!window.PublicKeyCredential) {
    throw new Error('Este dispositivo no soporta Face ID / passkeys');
  }
  const { data, error } = await supabase.auth.signInWithPasskey();
  if (error) throw error;
  return data;
}

/** Registrar passkey (Face ID) para la sesión actual. */
export async function registerPasskey(friendlyName = 'iPhone') {
  if (!window.PublicKeyCredential) {
    throw new Error('Este dispositivo no soporta Face ID / passkeys');
  }
  const { data, error } = await supabase.auth.registerPasskey(
    friendlyName ? { friendlyName } : undefined
  );
  if (error) throw error;
  return data;
}

export async function listPasskeys() {
  const { data, error } = await supabase.auth.passkey.list();
  if (error) throw error;
  return data || [];
}

export async function deletePasskey(passkeyId) {
  const { data, error } = await supabase.auth.passkey.delete({ passkeyId });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: appRedirectUrl()
  });
  if (error) throw error;
  return data;
}

export async function updatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, authEmail: user.email } : { id: user.id, email: user.email, authEmail: user.email };
}
