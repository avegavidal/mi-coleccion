import { el, emptyState, toast, setBusy, compressImage, formatMoney } from '../utils/dom.js';
import {
  listWishlist, createWishlistItem, deleteWishlistItem, withSignedWishlistPhotos
} from '../services/wishlistService.js';
import { getStatsData, renderBarChart } from '../services/statsService.js';
import {
  exportCollectionCSV, exportCollectionJSON, downloadText,
  importCollectionCSV, importCollectionJSON
} from '../services/exportService.js';
import { getProfile, signOut, updatePassword, listPasskeys, registerPasskey, deletePasskey } from '../services/authService.js';
import { getDashboardStats } from '../services/collectionService.js';
import { getRecognitionSettings, updateRecognitionSettings } from '../services/recognitionService.js';
import { getEmbeddingMeta, warmupEmbeddings } from '../services/embeddingService.js';
import { navigate } from '../utils/router.js';

export async function renderWishlist(root) {
  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Wishlist' }),
      el('p', { className: 'page-sub', text: 'Lo que aún quieres conseguir.' })
    ]),
    el('form', { id: 'wish-form', className: 'stack-form' }, [
      el('label', {}, [el('span', { text: 'Nombre *' }), el('input', { className: 'input', name: 'name', required: true })]),
      el('label', {}, [el('span', { text: 'Marca' }), el('input', { className: 'input', name: 'manufacturer' })]),
      el('label', {}, [el('span', { text: 'Franquicia / colección' }), el('input', { className: 'input', name: 'franchise' })]),
      el('label', {}, [el('span', { text: 'Serie' }), el('input', { className: 'input', name: 'series' })]),
      el('label', {}, [el('span', { text: 'Precio deseado' }), el('input', { className: 'input', name: 'desired_price', type: 'number', step: '0.01' })]),
      el('label', {}, [el('span', { text: 'Notas' }), el('textarea', { className: 'input', name: 'notes', rows: 2 })]),
      el('label', { className: 'btn btn-ghost', html: 'Foto opcional<input type="file" accept="image/*" id="wish-photo" hidden>' }),
      el('button', { type: 'submit', className: 'btn btn-primary btn-block', text: 'Agregar a wishlist' })
    ]),
    el('div', { className: 'wish-list', id: 'wish-list' })
  ]));

  let photoFile = null;
  root.querySelector('#wish-photo').addEventListener('change', (e) => {
    photoFile = e.target.files?.[0] || null;
  });

  root.querySelector('#wish-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('[type=submit]');
    setBusy(btn, true);
    try {
      let file = photoFile;
      if (file) file = await compressImage(file);
      await createWishlistItem(Object.fromEntries(fd.entries()), file);
      toast('Agregado', 'ok');
      location.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  const items = await withSignedWishlistPhotos(await listWishlist());
  const host = root.querySelector('#wish-list');
  if (!items.length) {
    host.append(emptyState('Wishlist vacía'));
    return;
  }
  for (const w of items) {
    host.append(
      el('article', { className: 'wish-card' }, [
        w.photoUrl ? el('img', { src: w.photoUrl, alt: '' }) : el('div', { className: 'photo-placeholder', text: '?' }),
        el('div', {}, [
          el('h3', { text: w.name }),
          el('p', { className: 'muted', text: [w.manufacturer, w.franchise, w.series].filter(Boolean).join(' · ') }),
          w.desired_price != null ? el('p', { text: formatMoney(w.desired_price, w.currency) }) : null,
          el('button', {
            type: 'button',
            className: 'btn btn-danger btn-sm',
            text: 'Eliminar',
            onClick: async () => {
              if (!confirm('¿Eliminar?')) return;
              await deleteWishlistItem(w.id);
              location.reload();
            }
          })
        ])
      ])
    );
  }
}

export async function renderStats(root) {
  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Estadísticas' }),
      el('p', { className: 'page-sub', text: 'Resumen de tu colección.' })
    ]),
    el('div', { className: 'stat-card highlight', id: 'value-card' }),
    el('section', { className: 'section' }, [el('h2', { text: 'Por categoría' }), el('div', { id: 'chart-col', className: 'chart' })]),
    el('section', { className: 'section' }, [el('h2', { text: 'Por marca' }), el('div', { id: 'chart-man', className: 'chart' })]),
    el('section', { className: 'section' }, [el('h2', { text: 'Por año' }), el('div', { id: 'chart-year', className: 'chart' })]),
    el('section', { className: 'section' }, [el('h2', { text: 'Agregadas por mes' }), el('div', { id: 'chart-month', className: 'chart' })]),
    el('p', { className: 'muted', id: 'dup-stat' })
  ]));

  const data = await getStatsData();
  root.querySelector('#value-card').innerHTML = `
    <div class="stat-value">${formatMoney(data.totalValue)}</div>
    <div class="stat-label">Valor total de adquisición · ${data.totalItems} registros</div>`;
  root.querySelector('#dup-stat').textContent = `Registros con quantity > 1: ${data.duplicates}`;
  renderBarChart(root.querySelector('#chart-col'), data.byCollection);
  renderBarChart(root.querySelector('#chart-man'), data.byManufacturer);
  renderBarChart(root.querySelector('#chart-year'), data.byYear);
  renderBarChart(root.querySelector('#chart-month'), data.byMonth, { maxBars: 12 });
}

export async function renderAccount(root) {
  const [profile, stats] = await Promise.all([getProfile(), getDashboardStats()]);
  let passkeys = [];
  try {
    passkeys = await listPasskeys();
  } catch {
    passkeys = [];
  }

  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Mi cuenta' })
    ]),
    el('div', { className: 'account-card' }, [
      el('p', {}, [el('strong', { text: 'Email: ' }), el('span', { text: profile?.authEmail || profile?.email || '—' })]),
      el('p', {}, [el('strong', { text: 'Rol: ' }), el('span', { text: profile?.role || 'user' })]),
      el('p', {}, [el('strong', { text: 'Registro: ' }), el('span', { text: profile?.created_at ? new Date(profile.created_at).toLocaleDateString('es') : '—' })]),
      el('p', {}, [el('strong', { text: 'Piezas: ' }), el('span', { text: String(stats.totalItems) })]),
      el('p', {}, [el('strong', { text: 'Categorías: ' }), el('span', { text: String(stats.totalCollections) })])
    ]),
    el('section', { className: 'section' }, [
      el('h2', { text: 'Face ID / Passkey' }),
      el('p', { className: 'page-sub', text: 'Registra un passkey una vez; luego entra desde el login con Face ID.' }),
      el('div', { id: 'passkey-list', className: 'passkey-list' }),
      el('button', { type: 'button', className: 'btn btn-passkey btn-block', id: 'register-passkey', text: 'Registrar Face ID en este iPhone' })
    ]),
    el('form', { id: 'pwd-form', className: 'stack-form' }, [
      el('h2', { text: 'Cambiar contraseña' }),
      el('input', { className: 'input', type: 'password', name: 'password', placeholder: 'Nueva contraseña', required: true, minlength: 6 }),
      el('button', { type: 'submit', className: 'btn btn-ghost btn-block', text: 'Actualizar contraseña' })
    ]),
    el('button', { type: 'button', className: 'btn btn-danger btn-block', id: 'logout', text: 'Cerrar sesión' })
  ]));

  const listHost = root.querySelector('#passkey-list');
  const paintPasskeys = (rows) => {
    listHost.innerHTML = '';
    if (!rows.length) {
      listHost.append(el('p', { className: 'muted', text: 'Ningún passkey registrado aún.' }));
      return;
    }
    for (const pk of rows) {
      listHost.append(
        el('div', { className: 'passkey-row' }, [
          el('div', {}, [
            el('strong', { text: pk.friendly_name || 'Passkey' }),
            el('p', { className: 'muted small', text: pk.created_at ? new Date(pk.created_at).toLocaleString('es') : '' })
          ]),
          el('button', {
            type: 'button',
            className: 'btn btn-ghost',
            text: 'Quitar',
            onclick: async () => {
              if (!confirm('¿Eliminar este passkey?')) return;
              try {
                await deletePasskey(pk.id);
                passkeys = passkeys.filter((p) => p.id !== pk.id);
                paintPasskeys(passkeys);
                toast('Passkey eliminado', 'ok');
              } catch (err) {
                toast(err.message, 'error');
              }
            }
          })
        ])
      );
    }
  };
  paintPasskeys(passkeys);

  root.querySelector('#register-passkey').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Face ID…');
    try {
      await registerPasskey('iPhone');
      passkeys = await listPasskeys();
      paintPasskeys(passkeys);
      toast('Face ID / passkey listo. Ya puedes usarlo en el login.', 'ok');
    } catch (err) {
      const msg = err?.message || String(err);
      if (/cancel|abort|not allowed/i.test(msg)) toast('Cancelado', 'info');
      else if (/passkey_disabled/i.test(msg)) toast('Activa Passkeys en Supabase → Authentication → Passkeys', 'error');
      else toast(msg, 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  root.querySelector('#pwd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await updatePassword(new FormData(e.target).get('password'));
      toast('Contraseña actualizada', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector('#logout').addEventListener('click', async () => {
    await signOut();
    navigate('login', true);
  });
}

export async function renderSettings(root) {
  const settings = await getRecognitionSettings();
  const meta = getEmbeddingMeta();

  root.append(el('div', { className: 'page' }, [
    el('header', { className: 'page-header' }, [
      el('h1', { text: 'Configuración' }),
      el('p', { className: 'page-sub', text: 'Umbrales de similitud y modelo visual.' })
    ]),
    el('div', { className: 'notice notice-info' }, [
      el('p', { text: `Modelo activo: ${meta.modelId}` }),
      el('p', { text: 'Se ejecuta en tu navegador (WebAssembly/WebGPU). Las fotos NO se envían a una API de IA de pago.' }),
      el('button', { type: 'button', className: 'btn btn-ghost', id: 'warmup', text: 'Precargar modelo' })
    ]),
    el('form', { id: 'thr-form', className: 'stack-form' }, [
      el('label', {}, [
        el('span', { text: 'Umbral alto (posible coincidencia clara)' }),
        el('input', { className: 'input', name: 'high_similarity_threshold', type: 'number', step: '0.01', min: '0', max: '1', value: settings.high_similarity_threshold })
      ]),
      el('label', {}, [
        el('span', { text: 'Umbral medio' }),
        el('input', { className: 'input', name: 'medium_similarity_threshold', type: 'number', step: '0.01', min: '0', max: '1', value: settings.medium_similarity_threshold })
      ]),
      el('label', {}, [
        el('span', { text: 'Umbral bajo (mínimo para mostrar)' }),
        el('input', { className: 'input', name: 'low_similarity_threshold', type: 'number', step: '0.01', min: '0', max: '1', value: settings.low_similarity_threshold })
      ]),
      el('label', {}, [
        el('span', { text: 'Máx. resultados de imágenes' }),
        el('input', { className: 'input', name: 'match_count', type: 'number', min: '1', max: '50', value: settings.match_count })
      ]),
      el('button', { type: 'submit', className: 'btn btn-primary btn-block', text: 'Guardar umbrales' })
    ]),
    el('section', { className: 'section' }, [
      el('h2', { text: 'Exportar / Importar' }),
      el('div', { className: 'btn-stack' }, [
        el('button', { type: 'button', className: 'btn btn-ghost btn-block', id: 'ex-json', text: 'Exportar JSON' }),
        el('button', { type: 'button', className: 'btn btn-ghost btn-block', id: 'ex-csv', text: 'Exportar CSV' }),
        el('label', { className: 'btn btn-ghost btn-block', html: 'Importar JSON/CSV<input type="file" accept=".json,.csv,text/csv,application/json" id="import-file" hidden>' })
      ]),
      el('p', { className: 'muted', text: 'La importación crea piezas nuevas sin fotografías/embeddings. Puedes agregar fotos después.' })
    ]),
    el('p', { className: 'muted', text: `Versión ${window.APP_CONFIG?.APP_VERSION || '1.0.0'}` })
  ]));

  root.querySelector('#warmup').addEventListener('click', async () => {
    try {
      await warmupEmbeddings((p) => toast(`Modelo ${p.progress || p.status}%`, 'info'));
      toast('Modelo listo', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector('#thr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await updateRecognitionSettings({
        high_similarity_threshold: Number(fd.get('high_similarity_threshold')),
        medium_similarity_threshold: Number(fd.get('medium_similarity_threshold')),
        low_similarity_threshold: Number(fd.get('low_similarity_threshold')),
        match_count: Number(fd.get('match_count'))
      });
      toast('Umbrales guardados', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector('#ex-json').addEventListener('click', async () => {
    downloadText(`coleccion-${Date.now()}.json`, await exportCollectionJSON(), 'application/json');
  });
  root.querySelector('#ex-csv').addEventListener('click', async () => {
    downloadText(`coleccion-${Date.now()}.csv`, await exportCollectionCSV(), 'text/csv');
  });
  root.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const result = file.name.endsWith('.json')
        ? await importCollectionJSON(text)
        : await importCollectionCSV(text);
      toast(`Importadas: ${result.imported}`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
