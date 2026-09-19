import { supabase, getConfig } from './supabaseClient.js';
import { getUser } from './authService.js';
import { getSignedUrl } from './imageService.js';

const BUCKET = () => getConfig().STORAGE_BUCKET || 'item-photos';

export async function listWishlist() {
  const { data, error } = await supabase
    .from('wishlist')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createWishlistItem(payload, photoFile = null) {
  const user = await getUser();
  let storagePath = null;

  if (photoFile) {
    const filename = `${crypto.randomUUID()}.jpg`;
    storagePath = `${user.id}/wishlist/${filename}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET())
      .upload(storagePath, photoFile, { contentType: photoFile.type || 'image/jpeg' });
    if (upErr) throw upErr;
  }

  const { data, error } = await supabase
    .from('wishlist')
    .insert({
      user_id: user.id,
      name: payload.name.trim(),
      manufacturer: payload.manufacturer || null,
      franchise: payload.franchise || null,
      series: payload.series || null,
      item_number: payload.item_number || null,
      desired_price: payload.desired_price !== '' && payload.desired_price != null
        ? Number(payload.desired_price) : null,
      currency: payload.currency || 'USD',
      notes: payload.notes || null,
      storage_path: storagePath
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateWishlistItem(id, updates) {
  const { data, error } = await supabase
    .from('wishlist')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteWishlistItem(id) {
  const { data: row } = await supabase.from('wishlist').select('storage_path').eq('id', id).maybeSingle();
  if (row?.storage_path) {
    await supabase.storage.from(BUCKET()).remove([row.storage_path]);
  }
  const { error } = await supabase.from('wishlist').delete().eq('id', id);
  if (error) throw error;
}

export async function withSignedWishlistPhotos(items) {
  const out = [];
  for (const item of items) {
    const url = item.storage_path ? await getSignedUrl(item.storage_path).catch(() => null) : null;
    out.push({ ...item, photoUrl: url });
  }
  return out;
}
