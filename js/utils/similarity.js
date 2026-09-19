/**
 * Utilidades puras de similitud / agrupación (testables sin DOM ni Supabase).
 */

export function l2Normalize(vec) {
  const arr = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / norm;
  return out;
}

export function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // asume vectores L2-normalizados
}

export function classifySimilarity(similarity, settings) {
  if (similarity >= settings.high_similarity_threshold) return 'high';
  if (similarity >= settings.medium_similarity_threshold) return 'medium';
  if (similarity >= settings.low_similarity_threshold) return 'low';
  return 'none';
}

export function formatSimilarity(similarity) {
  return `${Math.round((similarity || 0) * 100)}%`;
}

/**
 * Agrupa filas de match_item_images por item_id (máxima similitud).
 */
export function groupMatchesByItem(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const existing = map.get(row.item_id);
    if (!existing || row.similarity > existing.similarity) {
      map.set(row.item_id, {
        itemId: row.item_id,
        similarity: row.similarity,
        bestImageId: row.image_id,
        bestStoragePath: row.storage_path,
        bestImageType: row.image_type,
        name: row.item_name,
        manufacturer: row.manufacturer,
        franchise: row.franchise,
        series: row.series,
        itemNumber: row.item_number,
        character: row.character,
        category: row.category,
        quantity: row.quantity,
        collectionId: row.collection_id,
        collectionName: row.collection_name,
        images: []
      });
    }
  }

  for (const row of rows || []) {
    const g = map.get(row.item_id);
    if (!g.images.find((i) => i.imageId === row.image_id)) {
      g.images.push({
        imageId: row.image_id,
        storagePath: row.storage_path,
        imageType: row.image_type,
        similarity: row.similarity
      });
    }
  }

  return [...map.values()].sort((a, b) => b.similarity - a.similarity);
}

export function splitStrongWeak(grouped, settings) {
  const strong = grouped.filter((g) => g.similarity >= settings.medium_similarity_threshold);
  const weak = grouped.filter(
    (g) =>
      g.similarity < settings.medium_similarity_threshold &&
      g.similarity >= settings.low_similarity_threshold
  );
  return {
    strong,
    weak,
    hasClearMatch: strong.some((g) => g.similarity >= settings.high_similarity_threshold)
  };
}

export function escapeCsv(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function parseHashRoute(hash) {
  const raw = (hash || '#/').replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/').filter(Boolean);
  return { name: name || 'dashboard', params: rest };
}

export function isPublicRoute(name) {
  return ['login', 'register', 'recover'].includes(name);
}

export function storagePathOwnedBy(path, userId) {
  if (!path || !userId) return false;
  return path.split('/')[0] === userId;
}
