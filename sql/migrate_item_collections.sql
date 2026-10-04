-- =============================================================================
-- Multi-categoría: una figura puede pertenecer a varias categorías
-- Ejecutar en Supabase → SQL Editor si ya tenías el schema anterior.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.item_collections (
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, collection_id)
);

CREATE INDEX IF NOT EXISTS item_collections_user_id_idx
  ON public.item_collections(user_id);
CREATE INDEX IF NOT EXISTS item_collections_collection_id_idx
  ON public.item_collections(collection_id);
CREATE INDEX IF NOT EXISTS item_collections_item_id_idx
  ON public.item_collections(item_id);

-- Migrar colección única existente → relación N:N
INSERT INTO public.item_collections (item_id, collection_id, user_id)
SELECT i.id, i.collection_id, i.user_id
FROM public.items i
WHERE i.collection_id IS NOT NULL
ON CONFLICT (item_id, collection_id) DO NOTHING;

ALTER TABLE public.item_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_collections_select_own" ON public.item_collections;
CREATE POLICY "item_collections_select_own" ON public.item_collections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "item_collections_insert_own" ON public.item_collections;
CREATE POLICY "item_collections_insert_own" ON public.item_collections
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "item_collections_delete_own" ON public.item_collections;
CREATE POLICY "item_collections_delete_own" ON public.item_collections
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "item_collections_update_own" ON public.item_collections;
CREATE POLICY "item_collections_update_own" ON public.item_collections
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
