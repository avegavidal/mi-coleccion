import { el, toast, setBusy } from '../utils/dom.js';
import { navigate } from '../utils/router.js';
import * as auth from '../services/authService.js';

export async function renderLogin(root) {
  root.append(
    el('div', { className: 'auth-screen' }, [
      el('div', { className: 'auth-brand' }, [
        el('div', { className: 'logo-mark', text: 'MC' }),
        el('h1', { text: 'Mi Colección' }),
        el('p', { className: 'auth-sub', text: 'Inicia sesión para acceder a tu colección.' })
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
        ]),
        el('p', { className: 'auth-links' }, [
          el('span', { text: '¿No tienes cuenta? ' }),
          el('a', { href: '#/register', text: 'Crear cuenta' })
        ])
      ])
    ])
  );

  $('#login-form', root)?.addEventListener('submit', async (e) => {
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

function $(sel, root) {
  return root.querySelector(sel);
}

export async function renderRegister(root) {
  root.append(
    el('div', { className: 'auth-screen' }, [
      el('div', { className: 'auth-brand' }, [
        el('div', { className: 'logo-mark', text: 'MC' }),
        el('h1', { text: 'Crear cuenta' }),
        el('p', { className: 'auth-sub', text: 'Tu colección es privada. Solo tú puedes verla.' })
      ]),
      el('form', { className: 'auth-form', id: 'register-form' }, [
        el('label', {}, [
          el('span', { text: 'Nombre' }),
          el('input', { type: 'text', name: 'display_name', autocomplete: 'name', placeholder: 'Cómo te llamas' })
        ]),
        el('label', {}, [
          el('span', { text: 'Email' }),
          el('input', { type: 'email', name: 'email', autocomplete: 'email', required: true })
        ]),
        el('label', {}, [
          el('span', { text: 'Contraseña (mín. 6 caracteres)' }),
          el('input', { type: 'password', name: 'password', autocomplete: 'new-password', required: true, minlength: 6 })
        ]),
        el('button', { type: 'submit', className: 'btn btn-primary btn-block', text: 'Crear cuenta' }),
        el('p', { className: 'auth-links' }, [
          el('span', { text: '¿Ya tienes cuenta? ' }),
          el('a', { href: '#/login', text: 'Iniciar sesión' })
        ])
      ])
    ])
  );

  root.querySelector('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    setBusy(btn, true, 'Creando…');
    try {
      const data = await auth.signUp(fd.get('email'), fd.get('password'), fd.get('display_name'));
      if (data.session) {
        toast('Cuenta creada', 'ok');
        navigate('dashboard', true);
      } else {
        toast('Revisa tu email para confirmar la cuenta (si Supabase lo exige). Luego inicia sesión.', 'info');
        navigate('login');
      }
    } catch (err) {
      toast(err.message || 'No se pudo registrar', 'error');
    } finally {
      setBusy(btn, false);
    }
  });
}

export async function renderRecover(root) {
  root.append(
    el('div', { className: 'auth-screen' }, [
      el('div', { className: 'auth-brand' }, [
        el('h1', { text: 'Recuperar contraseña' }),
        el('p', { className: 'auth-sub', text: 'Te enviaremos un enlace a tu email.' })
      ]),
      el('form', { className: 'auth-form', id: 'recover-form' }, [
        el('label', {}, [
          el('span', { text: 'Email' }),
          el('input', { type: 'email', name: 'email', required: true })
        ]),
        el('button', { type: 'submit', className: 'btn btn-primary btn-block', text: 'Enviar enlace' }),
        el('p', { className: 'auth-links' }, [el('a', { href: '#/login', text: 'Volver al login' })])
      ]),
      el('hr', { className: 'auth-divider' }),
      el('form', { className: 'auth-form', id: 'magic-form' }, [
        el('p', { className: 'muted', text: 'Opcional: Magic Link (sin contraseña)' }),
        el('label', {}, [
          el('span', { text: 'Email' }),
          el('input', { type: 'email', name: 'email', required: true })
        ]),
        el('button', { type: 'submit', className: 'btn btn-ghost btn-block', text: 'Enviar Magic Link' })
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

  root.querySelector('#magic-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get('email');
    try {
      await auth.signInWithMagicLink(email);
      toast('Revisa tu email para el Magic Link.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
