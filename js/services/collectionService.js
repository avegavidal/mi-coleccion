import { supabase } from './supabaseClient.js';
import { getUser } from './authService.js';
import { deleteImageRecord } from './imageService.js';

/**
 * Normaliza categorías N:N + legacy collection_id en cada ítem.
 * Expone: collectionList[], collection_ids[], collectionNames, collections (primaria).
 * Las categorías se hidratan en cliente (nunca embed PostgREST items↔collections:
 * con item_collections hay 2 relaciones y falla en el teléfono).
 */
export function attachItemCollections(item) {
  if (!item) return item;
  const fromJoin = (item.item_collections || [])
    .map((row) => row.collections || (row.collection_id ? { id: row.collection_id, name: '?', color: null } : null))
    .filter(Boolean);
  const seen = new Set(fromJoin.map((c) => c.id));
  // Legacy: si aún no hay filas en item_collections pero sí collection_id
  if (item.collections?.id && !seen.has(item.collections.id)) {
    fromJoin.unshift(item.collections);
    seen.add(item.collections.id);
  } else if (item.collection_id && !seen.has(item.collection_id) && !fromJoin.length) {
    fromJoin.push({ id: item.collection_id, name: '?', color: null });
  }
  item.collectionList = fromJoin;
  item.collection_ids = fromJoin.map((c) => c.id);
  item.collectionNames = fromJoin.map((c) => c.name).filter((n) => n && n !== '?').join(' · ')
    || (fromJoin.length ? 'Categoría' : 'Sin categoría');
  item.collections = fromJoin[0] || null;
  if (fromJoin[0]?.id) item.collection_id = fromJoin[0].id;
  return item;
}

function attachMany(rows) {
  return (rows || []).map(attachItemCollections);
}

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
  const [collections, items] = await Promise.all([
    listCollections(),
    listItems({ sort: 'newest' })
  ]);
  return collections.map((c) => {
    const members = items.filter((i) => (i.collection_ids || []).includes(c.id) || i.collection_id === c.id);
    const thumbs = [];
    for (const item of members) {
      const img = (item.item_images || [])[0];
      if (img?.storage_path) thumbs.push(img.storage_path);
      if (thumbs.length >= 4) break;
    }
    return {
      ...c,
      itemCount: members.length,
      previewPaths: thumbs
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

/**
 * Reemplaza las categorías de una pieza. Sincroniza items.collection_id (primaria).
 * @param {string} itemId
 * @param {string[]} collectionIds
 */
export async function setItemCollections(itemId, collectionIds = []) {
  const user = await getUser();
  const ids = [...new Set((collectionIds || []).map(String).filter(Boolean))];

  const { error: delErr } = await supabase
    .from('item_collections')
    .delete()
    .eq('item_id', itemId);
  if (delErr) throw delErr;

  if (ids.length) {
    const rows = ids.map((collection_id) => ({
      item_id: itemId,
      collection_id,
      user_id: user.id
    }));
    const { error: insErr } = await supabase.from('item_collections').insert(rows);
    if (insErr) throw insErr;
  }

  const primary = ids[0] || null;
  const { error: upErr } = await supabase
    .from('items')
    .update({ collection_id: primary })
    .eq('id', itemId);
  if (upErr) throw upErr;

  return ids;
}

/** Agrega una categoría sin quitar las demás. */
export async function addItemToCollection(itemId, collectionId) {
  if (!itemId || !collectionId) return;
  const item = await getItem(itemId);
  const next = [...new Set([...(item.collection_ids || []), collectionId])];
  await setItemCollections(itemId, next);
}

/** Quita solo esa categoría. */
export async function removeItemFromCollection(itemId, collectionId) {
  if (!itemId || !collectionId) return;
  const item = await getItem(itemId);
  const next = (item.collection_ids || []).filter((id) => id !== collectionId);
  await setItemCollections(itemId, next);
}

function normalizeCollectionIds(payload) {
  if (Array.isArray(payload?.collection_ids)) {
    return [...new Set(payload.collection_ids.map(String).filter(Boolean))];
  }
  if (payload?.collection_id) return [String(payload.collection_id)];
  return [];
}

function buildItemsSelect(full) {
  // Nunca embeber collections aquí: PostgREST ve 2 relaciones items↔collections.
  return full
    ? `
      *,
      item_images ( id, storage_path, image_type, created_at )
    `
    : `
      id, name, quantity, collection_id, manufacturer, franchise, series,
      character_name, category, year, condition, purchase_price, currency,
      market_price_median, market_currency, created_at,
      item_images ( storage_path, created_at )
    `;
}

async function hydrateCollectionsClientSide(rows) {
  const list = rows || [];
  if (!list.length) return list;
  const collections = await listCollections().catch(() => []);
  const byId = Object.fromEntries(collections.map((c) => [c.id, c]));

  let links = [];
  try {
    const ids = list.map((r) => r.id).filter(Boolean);
    if (ids.length) {
      const { data, error } = await supabase
        .from('item_collections')
        .select('item_id, collection_id')
        .in('item_id', ids);
      if (!error) links = data || [];
    }
  } catch {
    links = [];
  }

  const byItem = new Map();
  for (const link of links) {
    const arr = byItem.get(link.item_id) || [];
    const col = byId[link.collection_id];
    if (col) arr.push(col);
    byItem.set(link.item_id, arr);
  }

  for (const item of list) {
    const fromJoin = [...(byItem.get(item.id) || [])];
    if (item.collection_id && byId[item.collection_id] && !fromJoin.some((c) => c.id === item.collection_id)) {
      fromJoin.unshift(byId[item.collection_id]);
    }
    item.item_collections = fromJoin.map((c) => ({
      collection_id: c.id,
      collections: c
    }));
    item.collections = fromJoin[0] || (item.collection_id && byId[item.collection_id]) || null;
  }
  return list;
}

export async function listItems(filters = {}) {
  const full = filters.full === true;
  const rows = await runListItemsQuery(filters, buildItemsSelect(full));
  await hydrateCollectionsClientSide(rows);
  const attached = attachMany(rows);
  if (!full) {
    for (const row of attached) {
      if (Array.isArray(row.item_images) && row.item_images.length > 1) {
        row.item_images = row.item_images.slice(0, 1);
      }
    }
  }
  return attached;
}

async function runListItemsQuery(filters, select) {
  let query = supabase.from('items').select(select);

  if (filters.ids?.length) query = query.in('id', filters.ids);

  if (filters.collection_id) {
    const { data: links, error: linkErr } = await supabase
      .from('item_collections')
      .select('item_id')
      .eq('collection_id', filters.collection_id);
    if (linkErr) {
      query = query.eq('collection_id', filters.collection_id);
    } else {
      const ids = [...new Set((links || []).map((r) => r.item_id))];
      const { data: legacy } = await supabase
        .from('items')
        .select('id')
        .eq('collection_id', filters.collection_id);
      for (const row of legacy || []) {
        if (!ids.includes(row.id)) ids.push(row.id);
      }
      if (!ids.length) return [];
      query = query.in('id', ids);
    }
  }

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

  if (/item_images/.test(select)) {
    query = query.order('created_at', { ascending: true, foreignTable: 'item_images' });
  }

  if (filters.limit != null) {
    const from = Math.max(0, Number(filters.offset) || 0);
    const to = from + Math.max(1, Number(filters.limit)) - 1;
    query = query.range(from, to);
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
      item_images ( id, storage_path, image_type, width, height, created_at, model_id )
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  const [row] = await hydrateCollectionsClientSide([data]);
  if (row?.item_images) {
    row.item_images.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  return attachItemCollections(row);
}

export async function createItem(payload) {
  const user = await getUser();
  const collectionIds = normalizeCollectionIds(payload);
  const row = {
    user_id: user.id,
    name: payload.name.trim(),
    collection_id: collectionIds[0] || null,
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

  if (collectionIds.length) {
    try {
      await setItemCollections(data.id, collectionIds);
    } catch (err) {
      // Sin tabla migrada: al menos quedó collection_id primaria
      console.warn('[collections] item_collections no disponible', err);
      if (collectionIds.length > 1) {
        throw new Error(
          'Solo se guardó la primera categoría. Ejecuta sql/migrate_item_collections.sql en Supabase para guardar varias.'
        );
      }
    }
  }

  return getItem(data.id).catch(() =>
    attachItemCollections({
      ...data,
      item_collections: collectionIds.map((collection_id) => ({ collection_id }))
    })
  );
}

export async function updateItem(id, updates) {
  const allowed = { ...updates };
  delete allowed.id;
  delete allowed.user_id;
  delete allowed.created_at;
  delete allowed.collections;
  delete allowed.collectionList;
  delete allowed.collectionNames;
  delete allowed.collection_ids;
  delete allowed.item_collections;
  delete allowed.item_images;

  const hasMulti = Object.prototype.hasOwnProperty.call(updates, 'collection_ids')
    || (Object.prototype.hasOwnProperty.call(updates, 'collection_id') && updates.collection_ids == null);

  let collectionIds = null;
  if (Object.prototype.hasOwnProperty.call(updates, 'collection_ids')) {
    collectionIds = normalizeCollectionIds({ collection_ids: updates.collection_ids });
  } else if (Object.prototype.hasOwnProperty.call(updates, 'collection_id')) {
    collectionIds = normalizeCollectionIds({ collection_id: updates.collection_id });
  }

  if (allowed.name) allowed.name = allowed.name.trim();
  if (allowed.quantity != null) allowed.quantity = Number(allowed.quantity);
  if (allowed.year === '') allowed.year = null;
  if (allowed.purchase_price === '') allowed.purchase_price = null;

  if (collectionIds) {
    allowed.collection_id = collectionIds[0] || null;
  }

  const { data, error } = await supabase
    .from('items')
    .update(allowed)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  if (collectionIds) {
    try {
      await setItemCollections(id, collectionIds);
    } catch (err) {
      console.warn('[collections] item_collections no disponible', err);
    }
  } else if (hasMulti) {
    // no-op
  }

  return getItem(id).catch(() => attachItemCollections(data));
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
