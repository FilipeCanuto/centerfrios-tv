-- Módulo de Endomarketing (MKT & RH): controle ao vivo de vídeos do YouTube nas TVs.
-- Idempotente: pode ser executada mais de uma vez sem erro.

-- 1) Estado por TV ----------------------------------------------------------------
ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS is_endomarketing_active boolean NOT NULL DEFAULT false;
-- endomarketing_state: { videoId, title, playing, currentTime, volume (0-100), isMuted, loop,
--                        fullscreen, momentTitle?, nonce }
-- nonce muda a cada comando "pontual" (trocar vídeo, voltar ao início): a TV aplica uma única vez.
ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS endomarketing_state jsonb;

-- O player das TVs (anon) lê só colunas liberadas explicitamente.
GRANT SELECT (is_endomarketing_active, endomarketing_state) ON public.tvs TO anon;

-- 2) Momentos pré-cadastrados -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.endomarketing_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  youtube_url text NOT NULL,
  suggested_volume integer NOT NULL DEFAULT 80 CHECK (suggested_volume BETWEEN 0 AND 100),
  loop boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Fila de reprodução (compartilhada entre os admins) -----------------------------
CREATE TABLE IF NOT EXISTS public.endomarketing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_url text NOT NULL,
  video_id text NOT NULL,
  title text,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.endomarketing_moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endomarketing_queue ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.endomarketing_moments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.endomarketing_queue TO authenticated;
GRANT ALL ON public.endomarketing_moments TO service_role;
GRANT ALL ON public.endomarketing_queue TO service_role;

DROP POLICY IF EXISTS "endo moments admin" ON public.endomarketing_moments;
CREATE POLICY "endo moments admin" ON public.endomarketing_moments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "endo queue admin" ON public.endomarketing_queue;
CREATE POLICY "endo queue admin" ON public.endomarketing_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 4) Realtime: a tabela tvs já está na publicação supabase_realtime (migration inicial).
--    Garante também a fila/momentos para o painel atualizar ao vivo entre admins.
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tvs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.endomarketing_moments; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.endomarketing_queue; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
