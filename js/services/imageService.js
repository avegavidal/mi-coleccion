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
    if (tPath && tPath !== path) {
      try {
        const { data, error } = await supabase.storage.from(BUCKET()).createSignedUrl(tPath, expiresIn);
        if (!error && data?.signedUrl) {
          cacheSet(cacheKey, data.signedUrl, expiresIn);
          return data.signedUrl;
        }
      } catch {
        // sin thumb subido aún
      }
    }
    // Transformación on-the-fly (si el proyecto tiene Image Transformation)
    try {
      const { data, error } = await supabase.storage.from(BUCKET()).createSignedUrl(path, expiresIn, {
        transform: { width: 360, height: 480, resize: 'cover', quality: 55 }
      });
      if (!error && data?.signedUrl) {
        cacheSet(cacheKey, data.signedUrl, expiresIn);
        return data.signedUrl;
      }
    } catch {
      // plan sin transform → full
    }
  }

  const { data, error } = await supabase.storage.from(BUCKET()).createSignedUrl(path, expiresIn);
  if (error) throw error;
  cacheSet(cacheKey, data.signedUrl, expiresIn);
  return data.signedUrl;
}

/**
 * Firma en lote (mucho más rápido que N llamadas).
 * @param {string[]} paths
 * @param {number} [expiresIn]
 * @param {{ variant?: 'full'|'thumb' }} [opts]
 */
export async function getSignedUrls(paths, expiresIn = 3600, opts = {}) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  const map = {};
  if (!unique.length) return map;
  const variant = opts.variant || 'full';

  if (variant === 'full') {
    const missing = [];
    for (const p of unique) {
      const hit = cacheGet(`${p}::full`);
      if (hit) map[p] = hit;
      else missing.push(p);
    }
    if (missing.length) {
      try {
        const { data, error } = await supabase.storage.from(BUCKET()).createSignedUrls(missing, expiresIn);
        if (!error && Array.isArray(data)) {
          for (const row of data) {
            const p = row.path || row.name;
            if (p && row.signedUrl && !row.error) {
              map[p] = row.signedUrl;
              cacheSet(`${p}::full`, row.signedUrl, expiresIn);
            }
          }
        } else {
          await Promise.all(missing.map(async (p) => {
            try { map[p] = await getSignedUrl(p, expiresIn, { variant: 'full' }); }
            catch { map[p] = null; }
          }));
        }
      } catch {
        await Promise.all(missing.map(async (p) => {
          try { map[p] = await getSignedUrl(p, expiresIn, { variant: 'full' }); }
          catch { map[p] = null; }
        }));
      }
    }
    for (const p of unique) {
      if (map[p] == null) map[p] = null;
    }
    return map;
  }

  // Thumbs: paralelo (cada path puede ser _t / transform / full)
  await Promise.all(
    unique.map(async (p) => {
      try {
        map[p] = await getSignedUrl(p, expiresIn, { variant: 'thumb' });
      } catch {
        map[p] = null;
      }
    })
  );
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
