/**
 * Motor de reconocimiento visual modular.
 * UI → recognitionService → embeddingService + Supabase RPC
 */
import { supabase, getConfig } from './supabaseClient.js';
import { generateEmbedding, embeddingToArray, warmupEmbeddings } from './embeddingService.js';
import { getUser } from './authService.js';
import { getSignedUrls } from './imageService.js';
import {
  groupMatchesByItem,
  classifySimilarity,
  formatSimilarity,
  splitStrongWeak
} from '../utils/similarity.js';

export { groupMatchesByItem, classifySimilarity, formatSimilarity };

export async function getRecognitionSettings() {
  const cfg = getConfig();
  const user = await getUser();
  if (!user) {
    return {
      high_similarity_threshold: cfg.HIGH_SIMILARITY_THRESHOLD,
      medium_similarity_threshold: cfg.MEDIUM_SIMILARITY_THRESHOLD,
      low_similarity_threshold: cfg.LOW_SIMILARITY_THRESHOLD,
      match_count: cfg.MATCH_COUNT
    };
  }

  const { data, error } = await supabase
    .from('recognition_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;

  return {
    high_similarity_threshold: data?.high_similarity_threshold ?? cfg.HIGH_SIMILARITY_THRESHOLD,
    medium_similarity_threshold: data?.medium_similarity_threshold ?? cfg.MEDIUM_SIMILARITY_THRESHOLD,
    low_similarity_threshold: data?.low_similarity_threshold ?? cfg.LOW_SIMILARITY_THRESHOLD,
    match_count: data?.match_count ?? cfg.MATCH_COUNT,
    active_model_id: data?.active_model_id ?? cfg.EMBEDDING_MODEL_ID
  };
}

export async function updateRecognitionSettings(updates) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('recognition_settings')
    .upsert({ user_id: user.id, ...updates, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * recognizeImage(image) → coincidencias agrupadas por pieza.
 */
export async function recognizeImage(image, options = {}) {
  const settings = await getRecognitionSettings();
  const threshold = options.threshold ?? settings.low_similarity_threshold;
  const matchCount = options.matchCount ?? settings.match_count;

  if (options.onProgress) options.onProgress({ stage: 'model', message: 'Preparando modelo visual…' });
  await warmupEmbeddings(options.onModelProgress);

  if (options.onProgress) options.onProgress({ stage: 'embed', message: 'Analizando fotografía…' });
  const embedding = await generateEmbedding(image, options.onModelProgress);
  const embeddingArr = embeddingToArray(embedding);

  if (options.onProgress) options.onProgress({ stage: 'search', message: 'Buscando en tu colección…' });

  const { data, error } = await supabase.rpc('match_item_images', {
    query_embedding: embeddingArr,
    match_threshold: threshold,
    match_count: matchCount
  });

  if (error) throw error;

  const grouped = groupMatchesByItem(data || []);

  // Firmar URLs de miniaturas
  const paths = grouped.flatMap((g) => [
    g.bestStoragePath,
    ...g.images.map((i) => i.storagePath)
  ]);
  const urlMap = await getSignedUrls(paths, 3600, { variant: 'thumb' });

  for (const g of grouped) {
    g.bestImageUrl = urlMap[g.bestStoragePath] || null;
    g.images = g.images.map((i) => ({
      ...i,
      url: urlMap[i.storagePath] || null
    }));
    g.level = classifySimilarity(g.similarity, settings);
  }

  const { strong, weak, hasClearMatch } = splitStrongWeak(grouped, settings);

  return {
    embedding: embeddingArr,
    matches: grouped,
    strongMatches: strong,
    weakMatches: weak,
    hasClearMatch,
    settings
  };
}

export async function saveIdentificationHistory({
  queryStoragePath,
  results,
  selectedItemId,
  selectedSimilarity,
  outcome
}) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('identification_history')
    .insert({
      user_id: user.id,
      query_storage_path: queryStoragePath || null,
      results: results || null,
      selected_item_id: selectedItemId || null,
      selected_similarity: selectedSimilarity ?? null,
      outcome
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function checkWishlistHints(match) {
  if (!match?.name) return [];
  const name = String(match.name).replace(/[%",]/g, '');
  let query = supabase.from('wishlist').select('*').ilike('name', `%${name}%`);
  if (match.itemNumber) {
    query = supabase
      .from('wishlist')
      .select('*')
      .or(`name.ilike.%${name}%,item_number.eq.${String(match.itemNumber).replace(/[%",]/g, '')}`);
  }
  const { data, error } = await query;
  if (error) return [];
  return data || [];
}
