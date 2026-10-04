import { supabase, getConfig } from './supabaseClient.js';
import { getUser } from './authService.js';
import { generateEmbedding, embeddingToArray } from './embeddingService.js';

const BUCKET = () => getConfig().STORAGE_BUCKET || 'item-photos';

/** Cache en memoria de URLs firmadas (evita re-firmar en la misma sesión). */
const signedCache = new Map();

function cacheGet(key) {
  const hit = signedCache.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) {
    signedCache.delete(key);
    return null;
  }
  return hit.url;
}

function cacheSet(key, url, expiresInSec) {
  if (!url) return;
  signedCache.set(key, {
    url,
    exp: Date.now() + Math.max(30_000, (Number(expiresInSec) || 3600) * 1000 - 60_000)
  });
}

/**
 * Ruta del thumbnail ligero (convención: mismo nombre + _t.webp).
 * @param {string} storagePath
 */
export function thumbStoragePath(storagePath) {
  if (!storagePath) return null;
  if (/_t\.(webp|jpe?g)$/i.test(storagePath)) return storagePath;
  return String(storagePath).replace(/\.[^.]+$/, '_t.webp');
}

const THUMB_OK_LS = 'mi_coleccion_thumbs_ok_v1';
const backfillInflight = new Map();
let backfillQueue = [];
let backfillRunning = 0;
const BACKFILL_CONCURRENCY = 2;

function knownThumbSet() {
  try {
    return new Set(JSON.parse(globalThis.localStorage?.getItem(THUMB_OK_LS) || '[]'));
  } catch {
    return new Set();
  }
}

export function markThumbReady(storagePath) {
  if (!storagePath || typeof localStorage === 'undefined') return;
  try {
    const s = knownThumbSet();
    s.add(storagePath);
    localStorage.setItem(THUMB_OK_LS, JSON.stringify([...s].slice(-800)));
  } catch {
    // ignore quota
  }
}

export function isThumbKnown(storagePath) {
  return knownThumbSet().has(storagePath);
}

async function batchSign(paths, expiresIn) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  const map = {};
  if (!unique.length) return map;
  const missing = [];
  for (const p of unique) {
    const hit = cacheGet(`${p}::raw`);
    if (hit) map[p] = hit;
    else missing.push(p);
  }
  if (!missing.length) return map;
  try {
    const { data, error } = await supabase.storage.from(BUCKET()).createSignedUrls(missing, expiresIn);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const p = row.path || row.name;
        if (p && row.signedUrl && !row.error) {
          map[p] = row.signedUrl;
          cacheSet(`${p}::raw`, row.signedUrl, expiresIn);
        }
      }
    }
  } catch {
    // fallback individual
  }
  await Promise.all(missing.filter((p) => !map[p]).map(async (p) => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET()).createSignedUrl(p, expiresIn);
      if (!error && data?.signedUrl) {
        map[p] = data.signedUrl;
        cacheSet(`${p}::raw`, data.signedUrl, expiresIn);
      }
    } catch {
      map[p] = null;
    }
  }));
  return map;
}

/**
 * Comprueba si una URL firmada responde (thumb existente).
 * @param {string} url
 */
export async function probeUrlOk(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'force-cache'
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * Genera y sube _t.webp para una foto antigua (una sola vez).
 * @param {string} storagePath
 * @returns {Promise<string|null>} URL firmada del thumb
 */
export async function ensureRemoteThumb(storagePath) {
  if (!storagePath) return null;
  if (backfillInflight.has(storagePath)) return backfillInflight.get(storagePath);

  const job = (async () => {
    const tPath = thumbStoragePath(storagePath);
    const expiresIn = 60 * 60 * 6;

    // ¿Ya existe?
    try {
      const signed = await batchSign([tPath], expiresIn);
      if (signed[tPath] && await probeUrlOk(signed[tPath])) {
        markThumbReady(storagePath);
        cacheSet(`${storagePath}::thumb`, signed[tPath], expiresIn);
        return signed[tPath];
      }
    } catch {
      // crear
    }

    const fullMap = await batchSign([storagePath], expiresIn);
    const fullUrl = fullMap[storagePath];
    if (!fullUrl) return null;

    const res = await fetch(fullUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const file = new File([blob], 'full.jpg', { type: blob.type || 'image/jpeg' });
    const { compressImageThumb } = await import('../utils/dom.js');
    const thumbFile = await compressImageThumb(file);

    const { error: upErr } = await supabase.storage.from(BUCKET()).upload(tPath, thumbFile, {
      contentType: thumbFile.type || 'image/webp',
      upsert: true
    });
    if (upErr) {
      console.warn('[images] backfill thumb failed', upErr);
      return null;
    }

    markThumbReady(storagePath);
    const again = await batchSign([tPath], expiresIn);
    const thumbUrl = again[tPath] || null;
    if (thumbUrl) cacheSet(`${storagePath}::thumb`, thumbUrl, expiresIn);
    return thumbUrl;
  })();

  backfillInflight.set(storagePath, job);
  try {
    return await job;
  } finally {
    backfillInflight.delete(storagePath);
  }
}

function applyThumbToDom(path, url) {
  if (!url || typeof document === 'undefined') return;
  const sel = `[data-storage-path="${CSS.escape(path)}"]`;
  document.querySelectorAll(sel).forEach((node) => {
    if (node.tagName === 'IMG') {
      if (node.dataset.thumbReady === '1' && node.src === url) return;
      node.dataset.thumbReady = '1';
      if (node.src !== url) node.src = url;
      return;
    }
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 360;
    img.height = 480;
    img.dataset.storagePath = path;
    img.dataset.thumbReady = '1';
    node.replaceWith(img);
  });
}

function pumpBackfill() {
  while (backfillRunning < BACKFILL_CONCURRENCY && backfillQueue.length) {
    const path = backfillQueue.shift();
    backfillRunning += 1;
    ensureRemoteThumb(path)
      .then((url) => applyThumbToDom(path, url))
      .catch(() => {})
      .finally(() => {
        backfillRunning -= 1;
        pumpBackfill();
      });
  }
}

/**
 * Encola generación de thumbs para fotos antiguas (no bloquea la UI).
 * @param {string[]} storagePaths
 */
export function scheduleThumbBackfill(storagePaths) {
  const known = knownThumbSet();
  for (const p of storagePaths || []) {
    if (!p || known.has(p)) continue;
    if (backfillQueue.includes(p) || backfillInflight.has(p)) continue;
    backfillQueue.push(p);
  }
  pumpBackfill();
}

/**
 * @param {string} path
 * @param {number} [expiresIn]
 * @param {{ variant?: 'full'|'thumb' }} [opts]
 */
export async function getSignedUrl(path, expiresIn = 3600, opts = {}) {
  if (!path) return null;
  const variant = opts.variant || 'full';
  const cacheKey = `${path}::${variant}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (variant === 'thumb') {
    const tPath = thumbStoragePath(path);
    if (isThumbKnown(path) && tPath) {
      const signed = await batchSign([tPath], expiresIn);
      if (signed[tPath]) {
        cacheSet(cacheKey, signed[tPath], expiresIn);
        return signed[tPath];
      }
    }
    if (tPath && tPath !== path) {
      const signed = await batchSign([tPath], expiresIn);
      if (signed[tPath] && (isThumbKnown(path) || await probeUrlOk(signed[tPath]))) {
        markThumbReady(path);
        cacheSet(cacheKey, signed[tPath], expiresIn);
        return signed[tPath];
      }
    }
    try {
      const { data, error } = await supabase.storage.from(BUCKET()).createSignedUrl(path, expiresIn, {
        transform: { width: 360, height: 480, resize: 'cover', quality: 55 }
      });
      if (!error && data?.signedUrl && await probeUrlOk(data.signedUrl)) {
        cacheSet(cacheKey, data.signedUrl, expiresIn);
        return data.signedUrl;
      }
    } catch {
      // sin transform
    }
  }

  const { data, error } = await supabase.storage.from(BUCKET()).createSignedUrl(path, expiresIn);
  if (error) throw error;
  cacheSet(cacheKey, data.signedUrl, expiresIn);
  return data.signedUrl;
}

/**
 * Firma en lote. Para thumbs: usa _t.webp si existe; si no, full + backfill en background.
 * @param {string[]} paths  storage_path originales (no _t)
 * @param {number} [expiresIn]
 * @param {{ variant?: 'full'|'thumb' }} [opts]
 * @returns {Promise<Record<string, string|null>>}
 */
export async function getSignedUrls(paths, expiresIn = 3600, opts = {}) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  const map = {};
  if (!unique.length) return map;
  const variant = opts.variant || 'full';

  if (variant === 'full') {
    const signed = await batchSign(unique, expiresIn);
    for (const p of unique) {
      map[p] = signed[p] || null;
      if (map[p]) cacheSet(`${p}::full`, map[p], expiresIn);
    }
    return map;
  }

  // THUMBS para listas — NUNCA devolver full (las viejas sin _t.webp se generan en background).
  // createSignedUrls puede devolver URL aunque el archivo no exista; el <img onerror> / backfill lo corrige.
  const thumbPaths = unique.map((p) => thumbStoragePath(p)).filter(Boolean);
  const thumbSigned = await batchSign(thumbPaths, expiresIn);
  const needBackfill = [];

  for (const p of unique) {
    const tPath = thumbStoragePath(p);
    const tUrl = tPath ? thumbSigned[tPath] : null;

    if (tUrl && isThumbKnown(p)) {
      map[p] = tUrl;
      cacheSet(`${p}::thumb`, tUrl, expiresIn);
      continue;
    }
    if (tUrl) {
      // Optimista: si el archivo no existe, itemCard onerror → ensureRemoteThumb
      map[p] = tUrl;
    } else {
      map[p] = null;
      needBackfill.push(p);
    }
  }

  if (needBackfill.length) scheduleThumbBackfill(needBackfill);
  return map;
}

function extFromMime(mime) {
  if (mime?.includes('png')) return 'png';
  if (mime?.includes('webp')) return 'webp';
  if (mime?.includes('heic') || mime?.includes('heif')) return 'heic';
  return 'jpg';
}

async function readImageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * Sube foto comprimida + thumbnail ligero, genera embedding y guarda registro.
 */
export async function uploadItemImage(itemId, file, imageType = 'additional', onProgress) {
  const user = await getUser();
  if (!user) throw new Error('No autenticado');

  if (onProgress) onProgress({ stage: 'compress', message: 'Optimizando foto…' });
  const { compressImageUpload, compressImageThumb } = await import('../utils/dom.js');
  const fullFile = await compressImageUpload(file);
  const thumbFile = await compressImageThumb(fullFile);

  const ext = extFromMime(fullFile.type);
  const id = crypto.randomUUID();
  const filename = `${id}.${ext}`;
  const storagePath = `${user.id}/${itemId}/${filename}`;
  const thumbPath = thumbStoragePath(storagePath);

  if (onProgress) onProgress({ stage: 'upload', message: 'Subiendo fotografía…' });

  const { error: uploadError } = await supabase.storage
    .from(BUCKET())
    .upload(storagePath, fullFile, {
      contentType: fullFile.type || 'image/jpeg',
      upsert: false
    });
  if (uploadError) throw uploadError;

  // Thumb best-effort (listas / dashboard)
  try {
    await supabase.storage.from(BUCKET()).upload(thumbPath, thumbFile, {
      contentType: thumbFile.type || 'image/webp',
      upsert: true
    });
    markThumbReady(storagePath);
  } catch (err) {
    console.warn('[images] thumb upload failed', err);
  }

  const dims = await readImageDimensions(fullFile);

  if (onProgress) onProgress({ stage: 'embedding', message: 'Generando representación visual…' });
  const embedding = await generateEmbedding(fullFile, (p) => {
    if (onProgress) onProgress({ stage: 'model', ...p });
  });

  if (onProgress) onProgress({ stage: 'save', message: 'Guardando…' });

  const { data, error } = await supabase
    .from('item_images')
    .insert({
      item_id: itemId,
      user_id: user.id,
      storage_path: storagePath,
      image_type: imageType || 'additional',
      embedding: embeddingToArray(embedding),
      width: dims.width,
      height: dims.height,
      mime_type: fullFile.type || 'image/jpeg',
      file_size: fullFile.size,
      model_id: getConfig().EMBEDDING_MODEL_ID
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(BUCKET()).remove([storagePath, thumbPath].filter(Boolean));
    throw error;
  }

  return data;
}

export async function deleteImageRecord(image) {
  if (image?.storage_path) {
    const paths = [image.storage_path, thumbStoragePath(image.storage_path)].filter(Boolean);
    await supabase.storage.from(BUCKET()).remove(paths);
  }
  if (image?.id) {
    const { error } = await supabase.from('item_images').delete().eq('id', image.id);
    if (error) throw error;
  }
}

export async function listItemImages(itemId) {
  const { data, error } = await supabase
    .from('item_images')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

export async function uploadTempIdentifyPhoto(file) {
  const user = await getUser();
  const { compressImageUpload } = await import('../utils/dom.js');
  const lite = await compressImageUpload(file);
  const filename = `${crypto.randomUUID()}.jpg`;
  const storagePath = `${user.id}/identify/${filename}`;
  const { error } = await supabase.storage.from(BUCKET()).upload(storagePath, lite, {
    contentType: lite.type || 'image/jpeg',
    upsert: false
  });
  if (error) throw error;
  return storagePath;
}
