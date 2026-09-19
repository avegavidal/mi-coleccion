import { supabase, getConfig } from './supabaseClient.js';
import { getUser } from './authService.js';
import { generateEmbedding, embeddingToArray } from './embeddingService.js';

const BUCKET = () => getConfig().STORAGE_BUCKET || 'item-photos';

export async function getSignedUrl(path, expiresIn = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET()).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function getSignedUrls(paths, expiresIn = 3600) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  const map = {};
  await Promise.all(
    unique.map(async (p) => {
      try {
        map[p] = await getSignedUrl(p, expiresIn);
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
 * Sube foto, genera embedding local y guarda registro.
 */
export async function uploadItemImage(itemId, file, imageType = 'additional', onProgress) {
  const user = await getUser();
  if (!user) throw new Error('No autenticado');

  const ext = extFromMime(file.type);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const storagePath = `${user.id}/${itemId}/${filename}`;

  if (onProgress) onProgress({ stage: 'upload', message: 'Subiendo fotografía…' });

  const { error: uploadError } = await supabase.storage
    .from(BUCKET())
    .upload(storagePath, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false
    });
  if (uploadError) throw uploadError;

  const dims = await readImageDimensions(file);

  if (onProgress) onProgress({ stage: 'embedding', message: 'Generando representación visual…' });
  const embedding = await generateEmbedding(file, (p) => {
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
      mime_type: file.type || 'image/jpeg',
      file_size: file.size,
      model_id: getConfig().EMBEDDING_MODEL_ID
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(BUCKET()).remove([storagePath]);
    throw error;
  }

  return data;
}

export async function deleteImageRecord(image) {
  if (image?.storage_path) {
    await supabase.storage.from(BUCKET()).remove([image.storage_path]);
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
  const filename = `${crypto.randomUUID()}.jpg`;
  const storagePath = `${user.id}/identify/${filename}`;
  const { error } = await supabase.storage.from(BUCKET()).upload(storagePath, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false
  });
  if (error) throw error;
  return storagePath;
}
