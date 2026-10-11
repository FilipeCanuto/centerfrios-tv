-- Playlists de vinhetas: várias listas com nome, cada TV escolhe a sua (tvs.vignette_playlist_id).
-- Preserva o que já existe: as vinhetas atuais viram as playlists "Vinhetas verticais" e
-- "Vinhetas horizontais", e TVs com "Intercalar vinhetas" ligado recebem a da sua orientação.
-- Idempotente: pode ser executada mais de uma vez sem erro.

CREATE TABLE IF NOT EXISTS public.vignette_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- só para organizar/identificar no painel (a TV usa a playlist que for atribuída a ela)
  orientation text NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait', 'landscape')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vignette_playlists ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vignette_playlists TO authenticated;
GRANT ALL ON public.vignette_playlists TO service_role;
DROP POLICY IF EXISTS "vignette playlists admin" ON public.vignette_playlists;
CREATE POLICY "vignette playlists admin" ON public.vignette_playlists FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- cada vinheta pertence a uma playlist de vinhetas (excluir a playlist exclui as vinhetas dela)
ALTER TABLE public.vignettes
  ADD COLUMN IF NOT EXISTS playlist_id uuid REFERENCES public.vignette_playlists(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS vignettes_playlist_order_idx ON public.vignettes (playlist_id, order_index);
GRANT SELECT (playlist_id) ON public.vignettes TO anon;

-- cada TV aponta para (no máximo) uma playlist de vinhetas; NULL = sem vinhetas
ALTER TABLE public.tvs
  ADD COLUMN IF NOT EXISTS vignette_playlist_id uuid REFERENCES public.vignette_playlists(id) ON DELETE SET NULL;
GRANT SELECT (vignette_playlist_id) ON public.tvs TO anon;

-- migração dos dados já cadastrados (só roda se ainda houver vinhetas sem playlist)
DO $$
DECLARE
  _ver uuid;
  _hor uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.vignettes WHERE playlist_id IS NULL AND orientation = 'portrait') THEN
    INSERT INTO public.vignette_playlists (name, orientation) VALUES ('Vinhetas verticais', 'portrait')
    RETURNING id INTO _ver;
    UPDATE public.vignettes SET playlist_id = _ver WHERE playlist_id IS NULL AND orientation = 'portrait';
    UPDATE public.tvs SET vignette_playlist_id = _ver
      WHERE vignettes_enabled = true AND vignette_playlist_id IS NULL AND orientation = 'portrait';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vignettes WHERE playlist_id IS NULL AND orientation = 'landscape') THEN
    INSERT INTO public.vignette_playlists (name, orientation) VALUES ('Vinhetas horizontais', 'landscape')
    RETURNING id INTO _hor;
    UPDATE public.vignettes SET playlist_id = _hor WHERE playlist_id IS NULL AND orientation = 'landscape';
    UPDATE public.tvs SET vignette_playlist_id = _hor
      WHERE vignettes_enabled = true AND vignette_playlist_id IS NULL AND orientation <> 'portrait';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.vignette_playlists; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
