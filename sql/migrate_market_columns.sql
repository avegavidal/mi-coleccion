-- Mi Colección — migración segura (idempotente)
-- Precio de mercado + character_name (por si el proyecto ya existía)

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS character_name TEXT;

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS market_price_low NUMERIC(12, 2);
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS market_price_median NUMERIC(12, 2);
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS market_price_high NUMERIC(12, 2);
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS market_sample_size INTEGER;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS market_currency TEXT;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS market_source TEXT;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS market_query TEXT;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS market_checked_at TIMESTAMPTZ;

-- Si quedó la columna legacy "character", copiar a character_name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'character'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'character_name'
  ) THEN
    EXECUTE 'UPDATE public.items SET character_name = COALESCE(character_name, character) WHERE character_name IS NULL AND character IS NOT NULL';
  END IF;
END $$;
