import { el, toast, setBusy } from '../utils/dom.js';
import { navigate } from '../utils/router.js';
import * as auth from '../services/authService.js';

export async function renderLogin(root) {
  root.append(
    el('div', { className: 'auth-screen' }, [
      el('div', { className: 'auth-brand' }, [
        el('div', { className: 'logo-mark', text: 'MC' }),
        el('h1', { text: 'Mi Colección' }),
        el('p', { className: 'auth-sub', text: 'Acceso privado. Google, Face ID o email.' }),
        el('p', { className: 'muted small', text: `v${window.APP_CONFIG?.APP_VERSION || ''}` })
      ]),
      el('div', { className: 'auth-sso' }, [
        el('button', {
          type: 'button',
          className: 'btn btn-google btn-block',
          id: 'btn-google',
          text: 'Continuar con Google'
        }),
        el('button', {
          type: 'button',
          className: 'btn btn-passkey btn-block',
          id: 'btn-passkey',
          text: 'Entrar con Face ID / Passkey'
        })
      ]),
      el('div', { className: 'auth-divider-label' }, [el('span', { text: 'o con email' })]),
      el('form', { className: 'auth-form', id: 'login-form' }, [
        el('label', {}, [
          el('span', { text: 'Email' }),
          el('input', { type: 'email', name: 'email', autocomplete: 'username webauthn', required: true, placeholder: 'tu@email.com' })
        ]),
        el('label', {}, [
          el('span', { text: 'Contraseña' }),
          el('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' })
        ]),
        el('button', { type: 'submit', className: 'btn btn-primary btn-block', text: 'Iniciar sesión' }),
        el('p', { className: 'auth-links' }, [
          el('a', { href: '#/recover', text: '¿Olvidaste tu contraseña?' })
        ])
      ])
    ])
  );

  root.querySelector('#btn-google')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Abriendo Google…');
    try {
      await auth.signInWithGoogle();
      // Redirección a Google; no navegar aquí
    } catch (err) {
      toast(err.message || 'No se pudo abrir Google', 'error');
      setBusy(btn, false);
    }
  });

  root.querySelector('#btn-passkey')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Face ID…');
    try {
      await auth.signInWithPasskey();
      toast('Sesión iniciada', 'ok');
      navigate('dashboard', true);
    } catch (err) {
      const msg = err?.message || String(err);
      if (/cancel|abort|not allowed/i.test(msg)) {
        toast('Cancelado', 'info');
      } else if (/passkey_disabled|not enabled/i.test(msg)) {
        toast('Activa Passkeys en Supabase (Authentication → Passkeys)', 'error');
      } else {
        toast(msg || 'No se pudo entrar con Face ID', 'error');
      }
      setBusy(btn, false);
    }
  });

  root.querySelector('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    setBusy(btn, true, 'Entrando…');
    try {
      await auth.signIn(fd.get('email'), fd.get('password'));
      toast('Sesión iniciada', 'ok');
      navigate('dashboard', true);
    } catch (err) {
      toast(err.message || 'No se pudo iniciar sesión', 'error');
    } finally {
      setBusy(btn, false);
    }
  });
}

/** Registro deshabilitado: las cuentas solo se crean en el panel de Supabase. */
export async function renderRegister(root) {
  navigate('login', true);
  root.append(
    el('div', { className: 'auth-screen' }, [
      el('p', { className: 'muted', text: 'El registro público está desactivado.' }),
      el('a', { href: '#/login', className: 'btn btn-primary', text: 'Ir a iniciar sesión' })
    ])
  );
}

export async function renderRecover(root) {
  root.append(
    el('div', { className: 'auth-screen' }, [
      el('div', { className: 'auth-brand' }, [
        el('h1', { text: 'Recuperar contraseña' }),
        el('p', { className: 'auth-sub', text: 'Te enviaremos un enlace a tu email (solo si la cuenta ya existe).' })
      ]),
      el('form', { className: 'auth-form', id: 'recover-form' }, [
        el('label', {}, [
          el('span', { text: 'Email' }),
          el('input', { type: 'email', name: 'email', required: true })
        ]),
        el('button', { type: 'submit', className: 'btn btn-primary btn-block', text: 'Enviar enlace' }),
        el('p', { className: 'auth-links' }, [el('a', { href: '#/login', text: 'Volver al login' })])
      ])
    ])
  );

  root.querySelector('#recover-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get('email');
    try {
      await auth.resetPassword(email);
      toast('Si el email existe, recibirás un enlace.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
