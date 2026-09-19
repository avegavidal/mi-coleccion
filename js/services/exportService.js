import { listItems, listCollections, createItem, createCollection } from './collectionService.js';
import { getSignedUrl } from './imageService.js';

function escapeCsv(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportCollectionJSON() {
  const [items, collections] = await Promise.all([listItems(), listCollections()]);
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    collections,
    items: items.map((i) => ({
      ...i,
      item_images: (i.item_images || []).map(({ embedding, ...rest }) => rest)
    }))
  };
  return JSON.stringify(payload, null, 2);
}

export async function exportCollectionCSV() {
  const items = await listItems();
  const headers = [
    'id', 'name', 'manufacturer', 'franchise', 'series', 'item_number',
    'character', 'category', 'year', 'condition', 'quantity',
    'purchase_price', 'currency', 'acquisition_date', 'notes',
    'collection_name', 'created_at'
  ];
  const lines = [headers.join(',')];
  for (const i of items) {
    lines.push([
      i.id,
      i.name,
      i.manufacturer,
      i.franchise,
      i.series,
      i.item_number,
      i.character,
      i.category,
      i.year,
      i.condition,
      i.quantity,
      i.purchase_price,
      i.currency,
      i.acquisition_date,
      i.notes,
      i.collections?.name,
      i.created_at
    ].map(escapeCsv).join(','));
  }
  return lines.join('\n');
}

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h.trim()] = r[idx] ?? '';
    });
    return obj;
  });
}

export async function importCollectionJSON(text) {
  const data = JSON.parse(text);
  const collections = await listCollections();
  const byName = Object.fromEntries(collections.map((c) => [c.name.toLowerCase(), c]));

  let imported = 0;
  for (const item of data.items || []) {
    let collectionId = null;
    const cName = item.collections?.name || item.collection_name;
    if (cName) {
      const key = cName.toLowerCase();
      if (!byName[key]) {
        const created = await createCollection(cName);
        byName[key] = created;
      }
      collectionId = byName[key].id;
    }
    await createItem({
      name: item.name,
      manufacturer: item.manufacturer,
      franchise: item.franchise,
      series: item.series,
      item_number: item.item_number,
      character: item.character,
      category: item.category,
      year: item.year,
      condition: item.condition,
      quantity: item.quantity || 1,
      purchase_price: item.purchase_price,
      currency: item.currency,
      acquisition_date: item.acquisition_date,
      notes: item.notes,
      collection_id: collectionId
    });
    imported++;
  }
  return { imported };
}

export async function importCollectionCSV(text) {
  const rows = parseCsv(text);
  const collections = await listCollections();
  const byName = Object.fromEntries(collections.map((c) => [c.name.toLowerCase(), c]));
  let imported = 0;

  for (const row of rows) {
    if (!row.name) continue;
    let collectionId = null;
    if (row.collection_name) {
      const key = row.collection_name.toLowerCase();
      if (!byName[key]) {
        const created = await createCollection(row.collection_name);
        byName[key] = created;
      }
      collectionId = byName[key].id;
    }
    await createItem({
      name: row.name,
      manufacturer: row.manufacturer || null,
      franchise: row.franchise || null,
      series: row.series || null,
      item_number: row.item_number || null,
      character: row.character || null,
      category: row.category || null,
      year: row.year || null,
      condition: row.condition || null,
      quantity: row.quantity ? Number(row.quantity) : 1,
      purchase_price: row.purchase_price || null,
      currency: row.currency || 'USD',
      acquisition_date: row.acquisition_date || null,
      notes: row.notes || null,
      collection_id: collectionId
    });
    imported++;
  }
  return { imported };
}

export async function enrichItemsWithThumbs(items) {
  const out = [];
  for (const item of items) {
    const first = (item.item_images || [])[0];
    let thumbUrl = null;
    if (first?.storage_path) {
      try {
        thumbUrl = await getSignedUrl(first.storage_path);
      } catch {
        thumbUrl = null;
      }
    }
    out.push({ ...item, thumbUrl });
  }
  return out;
}
