import { supabase } from './supabaseClient.js';
import { getUser } from './authService.js';
import { deleteImageRecord } from './imageService.js';

export async function listCollections() {
  const { data, error } = await supabase
    .from('collections')
    .select('*')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function getCollection(id) {
  const { data, error } = await supabase
    .from('collections')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Categorías con conteo y rutas de fotos para mosaico.
 */
export async function listCollectionsWithStats() {
  const [collections, items] = await Promise.all([listCollections(), listItems()]);
  return collections.map((c) => {
    const members = items.filter((i) => i.collection_id === c.id);
    const thumbs = [];
    for (const item of members) {
      const img = (item.item_images || [])[0];
      if (img?.storage_path) thumbs.push(img.storage_path);
      if (thumbs.length >= 4) break;
    }
    return {
      ...c,
      itemCount: members.length,
      previewPaths: thumbs,
      items: members
    };
  });
}

export async function createCollection(name, description = null, color = '#0f766e') {
  const user = await getUser();
  const { data, error } = await supabase
    .from('collections')
    .insert({ user_id: user.id, name: name.trim(), description, color })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCollection(id, updates) {
  const { data, error } = await supabase
    .from('collections')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCollection(id) {
  const { error } = await supabase.from('collections').delete().eq('id', id);
  if (error) throw error;
}

export async function listItems(filters = {}) {
  let query = supabase
    .from('items')
    .select(`
      *,
      collections ( id, name, color ),
      item_images ( id, storage_path, image_type, created_at )
    `);

  if (filters.collection_id) query = query.eq('collection_id', filters.collection_id);
  if (filters.manufacturer) query = query.ilike('manufacturer', `%${filters.manufacturer}%`);
  if (filters.condition) query = query.eq('condition', filters.condition);
  if (filters.year) query = query.eq('year', Number(filters.year));
  if (filters.min_quantity != null) query = query.gte('quantity', filters.min_quantity);
  if (filters.search) {
    const s = filters.search.trim();
    query = query.or(
      `name.ilike.%${s}%,manufacturer.ilike.%${s}%,franchise.ilike.%${s}%,series.ilike.%${s}%,character_name.ilike.%${s}%,item_number.ilike.%${s}%,category.ilike.%${s}%`
    );
  }

  switch (filters.sort) {
    case 'name':
      query = query.order('name');
      break;
    case 'collection':
      query = query.order('collection_id');
      break;
    case 'value':
      query = query.order('purchase_price', { ascending: false, nullsFirst: false });
      break;
    case 'quantity':
      query = query.order('quantity', { ascending: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getItem(id) {
  const { data, error } = await supabase
    .from('items')
    .select(`
      *,
      collections ( id, name, color ),
      item_images ( id, storage_path, image_type, width, height, created_at, model_id )
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  if (data?.item_images) {
    data.item_images.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  return data;
}

export async function createItem(payload) {
  const user = await getUser();
  const row = {
    user_id: user.id,
    name: payload.name.trim(),
    collection_id: payload.collection_id || null,
    manufacturer: payload.manufacturer || null,
    franchise: payload.franchise || null,
    series: payload.series || null,
    item_number: payload.item_number || null,
    character_name: payload.character || payload.character_name || null,
    category: payload.category || null,
    year: payload.year ? Number(payload.year) : null,
    condition: payload.condition || null,
    quantity: payload.quantity != null ? Number(payload.quantity) : 1,
    purchase_price: payload.purchase_price != null && payload.purchase_price !== ''
      ? Number(payload.purchase_price) : null,
    currency: payload.currency || 'USD',
    acquisition_date: payload.acquisition_date || null,
    notes: payload.notes || null
  };

  const { data, error } = await supabase.from('items').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateItem(id, updates) {
  const allowed = { ...updates };
  delete allowed.id;
  delete allowed.user_id;
  delete allowed.created_at;
  delete allowed.collections;
  delete allowed.item_images;

  if (allowed.name) allowed.name = allowed.name.trim();
  if (allowed.quantity != null) allowed.quantity = Number(allowed.quantity);
  if (allowed.year === '') allowed.year = null;
  if (allowed.purchase_price === '') allowed.purchase_price = null;

  const { data, error } = await supabase
    .from('items')
    .update(allowed)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function incrementQuantity(id, by = 1) {
  const item = await getItem(id);
  return updateItem(id, { quantity: (item.quantity || 0) + by });
}

export async function deleteItem(id) {
  const item = await getItem(id);
  if (item?.item_images?.length) {
    for (const img of item.item_images) {
      await deleteImageRecord(img);
    }
  }
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
}

export async function getDashboardStats() {
  const [itemsRes, collectionsRes, wishlistRes] = await Promise.all([
    supabase.from('items').select('id, quantity, purchase_price, created_at, name, collection_id'),
    supabase.from('collections').select('id'),
    supabase.from('wishlist').select('id')
  ]);

  if (itemsRes.error) throw itemsRes.error;
  if (collectionsRes.error) throw collectionsRes.error;
  if (wishlistRes.error) throw wishlistRes.error;

  const items = itemsRes.data || [];
  const totalPieces = items.reduce((s, i) => s + (i.quantity || 0), 0);
  const duplicates = items.filter((i) => (i.quantity || 0) > 1);
  const recent = [...items]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);

  return {
    totalItems: items.length,
    totalPieces,
    totalCollections: (collectionsRes.data || []).length,
    duplicatesCount: duplicates.length,
    wishlistCount: (wishlistRes.data || []).length,
    recent
  };
}

export async function getDuplicateItems() {
  return listItems({ min_quantity: 2, sort: 'quantity' });
}
