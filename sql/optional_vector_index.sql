-- Ejecutar SOLO después de tener imágenes con embeddings.
-- Mejora el rendimiento de match_item_images en colecciones grandes.

CREATE INDEX IF NOT EXISTS item_images_embedding_hnsw_idx
  ON public.item_images
  USING hnsw (embedding vector_cosine_ops);
