-- =============================================================================
-- Mi Colección — esquema completo para Supabase
-- Ejecutar TODO este archivo en: Supabase → SQL Editor → New query → Run
-- =============================================================================

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- -----------------------------------------------------------------------------
-- Perfiles (roles preparados para futuro admin)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Colecciones personalizadas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#C4A574',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS collections_user_id_idx ON public.collections(user_id);

-- -----------------------------------------------------------------------------
-- Piezas / items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id UUID REFERENCES public.collections(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  manufacturer TEXT,
  franchise TEXT,
  series TEXT,
  item_number TEXT,
  character_name TEXT,
  category TEXT,
  year INTEGER,
  condition TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  purchase_price NUMERIC(12, 2),
  currency TEXT DEFAULT 'USD',
  acquisition_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS items_user_id_idx ON public.items(user_id);
CREATE INDEX IF NOT EXISTS items_collection_id_idx ON public.items(collection_id);
CREATE INDEX IF NOT EXISTS items_name_idx ON public.items(user_id, name);
CREATE INDEX IF NOT EXISTS items_manufacturer_idx ON public.items(user_id, manufacturer);
CREATE INDEX IF NOT EXISTS items_quantity_idx ON public.items(user_id, quantity);

-- -----------------------------------------------------------------------------
-- Fotografías + embeddings (CLIP ViT-B/32 → 512 dims)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  image_type TEXT NOT NULL DEFAULT 'additional'
    CHECK (image_type IN ('frontal', 'trasera', 'lateral', 'caja', 'codigo', 'etiqueta', 'additional')),
  embedding vector(512),
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  file_size INTEGER,
  model_id TEXT DEFAULT 'Xenova/clip-vit-base-patch32',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS item_images_item_id_idx ON public.item_images(item_id);
CREATE INDEX IF NOT EXISTS item_images_user_id_idx ON public.item_images(user_id);
-- Índice vectorial: créalo DESPUÉS de tener al menos algunas imágenes
-- (ver sql/optional_vector_index.sql). Sin índice la búsqueda sigue funcionando.

-- -----------------------------------------------------------------------------
-- Wishlist
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wishlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manufacturer TEXT,
  franchise TEXT,
  series TEXT,
  item_number TEXT,
  desired_price NUMERIC(12, 2),
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wishlist_user_id_idx ON public.wishlist(user_id);

-- -----------------------------------------------------------------------------
-- Historial de identificaciones
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query_storage_path TEXT,
  results JSONB,
  selected_item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  selected_similarity NUMERIC(6, 4),
  outcome TEXT CHECK (outcome IN ('confirmed', 'added_new', 'cancelled', 'no_match')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS identification_history_user_id_idx
  ON public.identification_history(user_id);

-- -----------------------------------------------------------------------------
-- Modelos de embedding (para cambio futuro de proveedor)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.embedding_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  runs_locally BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.embedding_models (id, name, provider, dimensions, runs_locally, notes, is_active)
VALUES (
  'Xenova/clip-vit-base-patch32',
  'CLIP ViT-B/32 (Transformers.js)',
  'local-browser',
  512,
  TRUE,
  'Embeddings visuales en el navegador vía WebAssembly. Gratis, sin API de pago.',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Ajustes de reconocimiento (umbrales configurables)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recognition_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  high_similarity_threshold NUMERIC(4, 3) NOT NULL DEFAULT 0.820,
  medium_similarity_threshold NUMERIC(4, 3) NOT NULL DEFAULT 0.700,
  low_similarity_threshold NUMERIC(4, 3) NOT NULL DEFAULT 0.550,
  match_count INTEGER NOT NULL DEFAULT 12,
  active_model_id TEXT REFERENCES public.embedding_models(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Trigger: crear perfil al registrarse
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'user'
  );

  INSERT INTO public.recognition_settings (user_id, active_model_id)
  VALUES (NEW.id, 'Xenova/clip-vit-base-patch32');

  INSERT INTO public.collections (user_id, name, description)
  VALUES
    (NEW.id, 'General', 'Colección principal'),
    (NEW.id, 'Marvel', NULL),
    (NEW.id, 'Star Wars', NULL),
    (NEW.id, 'Pokémon', NULL),
    (NEW.id, 'Funko', NULL),
    (NEW.id, 'Otros', NULL)
  ON CONFLICT (user_id, name) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS collections_updated_at ON public.collections;
CREATE TRIGGER collections_updated_at
  BEFORE UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS items_updated_at ON public.items;
CREATE TRIGGER items_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS wishlist_updated_at ON public.wishlist;
CREATE TRIGGER wishlist_updated_at
  BEFORE UPDATE ON public.wishlist
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- RPC: búsqueda vectorial SOLO del usuario autenticado
-- =============================================================================
CREATE OR REPLACE FUNCTION public.match_item_images(
  query_embedding vector(512),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 20
)
RETURNS TABLE (
  image_id UUID,
  item_id UUID,
  storage_path TEXT,
  image_type TEXT,
  similarity FLOAT,
  item_name TEXT,
  manufacturer TEXT,
  franchise TEXT,
  series TEXT,
  item_number TEXT,
  character_name TEXT,
  category TEXT,
  quantity INT,
  collection_id UUID,
  collection_name TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    ii.id AS image_id,
    ii.item_id,
    ii.storage_path,
    ii.image_type,
    (1 - (ii.embedding <=> query_embedding))::FLOAT AS similarity,
    i.name AS item_name,
    i.manufacturer,
    i.franchise,
    i.series,
    i.item_number,
    i.character_name,
    i.category,
    i.quantity,
    i.collection_id,
    c.name AS collection_name
  FROM public.item_images ii
  INNER JOIN public.items i ON i.id = ii.item_id
  LEFT JOIN public.collections c ON c.id = i.collection_id
  WHERE ii.user_id = auth.uid()
    AND i.user_id = auth.uid()
    AND ii.embedding IS NOT NULL
    AND (1 - (ii.embedding <=> query_embedding)) >= match_threshold
  ORDER BY ii.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_item_images(vector, FLOAT, INT) TO authenticated;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embedding_models ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Collections
DROP POLICY IF EXISTS "collections_select_own" ON public.collections;
CREATE POLICY "collections_select_own" ON public.collections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "collections_insert_own" ON public.collections;
CREATE POLICY "collections_insert_own" ON public.collections
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "collections_update_own" ON public.collections;
CREATE POLICY "collections_update_own" ON public.collections
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "collections_delete_own" ON public.collections;
CREATE POLICY "collections_delete_own" ON public.collections
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Items
DROP POLICY IF EXISTS "items_select_own" ON public.items;
CREATE POLICY "items_select_own" ON public.items
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "items_insert_own" ON public.items;
CREATE POLICY "items_insert_own" ON public.items
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "items_update_own" ON public.items;
CREATE POLICY "items_update_own" ON public.items
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "items_delete_own" ON public.items;
CREATE POLICY "items_delete_own" ON public.items
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Item images
DROP POLICY IF EXISTS "item_images_select_own" ON public.item_images;
CREATE POLICY "item_images_select_own" ON public.item_images
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "item_images_insert_own" ON public.item_images;
CREATE POLICY "item_images_insert_own" ON public.item_images
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "item_images_update_own" ON public.item_images;
CREATE POLICY "item_images_update_own" ON public.item_images
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "item_images_delete_own" ON public.item_images;
CREATE POLICY "item_images_delete_own" ON public.item_images
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Wishlist
DROP POLICY IF EXISTS "wishlist_select_own" ON public.wishlist;
CREATE POLICY "wishlist_select_own" ON public.wishlist
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "wishlist_insert_own" ON public.wishlist;
CREATE POLICY "wishlist_insert_own" ON public.wishlist
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "wishlist_update_own" ON public.wishlist;
CREATE POLICY "wishlist_update_own" ON public.wishlist
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "wishlist_delete_own" ON public.wishlist;
CREATE POLICY "wishlist_delete_own" ON public.wishlist
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Identification history
DROP POLICY IF EXISTS "id_history_select_own" ON public.identification_history;
CREATE POLICY "id_history_select_own" ON public.identification_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "id_history_insert_own" ON public.identification_history;
CREATE POLICY "id_history_insert_own" ON public.identification_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "id_history_delete_own" ON public.identification_history;
CREATE POLICY "id_history_delete_own" ON public.identification_history
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Recognition settings
DROP POLICY IF EXISTS "recognition_settings_select_own" ON public.recognition_settings;
CREATE POLICY "recognition_settings_select_own" ON public.recognition_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "recognition_settings_update_own" ON public.recognition_settings;
CREATE POLICY "recognition_settings_update_own" ON public.recognition_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "recognition_settings_insert_own" ON public.recognition_settings;
CREATE POLICY "recognition_settings_insert_own" ON public.recognition_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Embedding models: lectura para autenticados (catálogo)
DROP POLICY IF EXISTS "embedding_models_select" ON public.embedding_models;
CREATE POLICY "embedding_models_select" ON public.embedding_models
  FOR SELECT TO authenticated USING (TRUE);

-- =============================================================================
-- STORAGE: bucket privado item-photos
-- Ejecutar también en Dashboard → Storage si el bucket no se crea por SQL
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-photos',
  'item-photos',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

-- Ruta esperada: {user_id}/{item_id_or_temp}/{filename}
DROP POLICY IF EXISTS "item_photos_select_own" ON storage.objects;
CREATE POLICY "item_photos_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'item-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "item_photos_insert_own" ON storage.objects;
CREATE POLICY "item_photos_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'item-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "item_photos_update_own" ON storage.objects;
CREATE POLICY "item_photos_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'item-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'item-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "item_photos_delete_own" ON storage.objects;
CREATE POLICY "item_photos_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'item-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- FIN DEL ESQUEMA
-- =============================================================================
