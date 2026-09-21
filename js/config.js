/**
 * Configuración local — valores de Supabase (solo anon key pública).
 * Este archivo NO debe contener la clave secreta de servicio del proyecto.
 */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://rqynijhhxpkmeubzcrbv.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxeW5pamhoeHBrbWV1YnpjcmJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4MzQyNDIsImV4cCI6MjEwNTQxMDI0Mn0.0XFy_pG7kW2UQbXrgBySi_dOmqVKDZzcKC-Jn8Rpg8g',

  HIGH_SIMILARITY_THRESHOLD: 0.82,
  MEDIUM_SIMILARITY_THRESHOLD: 0.70,
  LOW_SIMILARITY_THRESHOLD: 0.55,

  MATCH_COUNT: 20,
  EMBEDDING_DIMENSIONS: 512,
  EMBEDDING_MODEL_ID: 'Xenova/clip-vit-base-patch32',
  STORAGE_BUCKET: 'item-photos',

  APP_NAME: 'Mi Colección',
  APP_VERSION: '1.4.1',

  // Mercados: US / JP (+ VIS para Lens si hay foto)
  MARKET_REGIONS: 'US,JP,VIS',

  // Dejar vacío en el repo. Guarda la key en Configuración (queda en tu iPhone).
  GEMINI_API_KEY: ''
};
