/**
 * Configuración de la aplicación.
 * Copia este archivo como config.js y rellena tus valores de Supabase.
 *
 * NUNCA pongas la service_role key aquí. Solo la anon/public key.
 */
window.APP_CONFIG = {
  // Project Settings → API → Project URL
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',

  // Project Settings → API → anon public
  SUPABASE_ANON_KEY: 'TU_ANON_KEY',

  // Umbrales por defecto (también editables en Configuración)
  HIGH_SIMILARITY_THRESHOLD: 0.82,
  MEDIUM_SIMILARITY_THRESHOLD: 0.70,
  LOW_SIMILARITY_THRESHOLD: 0.55,

  MATCH_COUNT: 20,
  EMBEDDING_DIMENSIONS: 512,
  EMBEDDING_MODEL_ID: 'Xenova/clip-vit-base-patch32',
  STORAGE_BUCKET: 'item-photos',

  APP_NAME: 'Mi Colección',
  APP_VERSION: '1.0.0',

  // Mercados de referencia (sin Mercado Libre):
  // US = eBay + Mercari US | JP = Yahoo Auctions + Mercari JP + AmiAmi + Mandarake + HLJ
  MARKET_REGIONS: 'US,JP'
};
