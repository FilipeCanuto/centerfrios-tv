-- Vinhetas: vídeos do YouTube intercalados com a playlist da TV
-- (vinheta 1, item 1, vinheta 2, item 2, ...). Duas listas: vertical (TVs em pé) e horizontal.
-- Idempotente: pode ser executada mais de uma vez sem erro.

CREATE TABLE IF NOT EXISTS public.vignettes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orientation text NOT NULL CHECK (orientation IN ('portrait', 'landscape')),
  youtube_url text NOT NULL,
  video_id text NOT NULL,
  title text,
  order_index integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vignettes_orientation_order_idx ON public.vignettes (orientation, order_index);

ALTER TABLE public.vignettes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vignettes TO authenticated;
GRANT ALL ON public.vignettes TO service_role;
-- O player das TVs (anon) lê só as vinhetas ativas.
GRANT SELECT (id, orientation, youtube_url, video_id, title, order_index, active) ON public.vignettes TO anon;

DROP POLICY IF EXISTS "vignettes public read active" ON public.vignettes;
CREATE POLICY "vignettes public read active" ON public.vignettes FOR SELECT TO anon
  USING (active = true);

DROP POLICY IF EXISTS "vignettes admin" ON public.vignettes;
CREATE POLICY "vignettes admin" ON public.vignettes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Liga/desliga as vinhetas por TV (desligado por padrão: nada muda nas TVs até ligar).
ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS vignettes_enabled boolean NOT NULL DEFAULT false;
GRANT SELECT (vignettes_enabled) ON public.tvs TO anon;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.vignettes; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
