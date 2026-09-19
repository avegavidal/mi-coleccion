import { el, toast, setBusy } from '../utils/dom.js';
import { navigate } from '../utils/router.js';
import * as auth from '../services/authService.js';

export async function renderLogin(root) {
  root.append(
    el('div', { className: 'auth-screen' }, [
      el('div', { className: 'auth-brand' }, [
        el('div', { className: 'logo-mark', text: 'MC' }),
        el('h1', { text: 'Mi Colección' }),
        el('p', { className: 'auth-sub', text: 'Acceso privado. Solo cuentas autorizadas.' })
      ]),
      el('form', { className: 'auth-form', id: 'login-form' }, [
        el('label', {}, [
          el('span', { text: 'Email' }),
          el('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'tu@email.com' })
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
