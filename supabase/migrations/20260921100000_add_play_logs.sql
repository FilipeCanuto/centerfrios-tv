-- Relatório de exibição (proof-of-play): contagem diária de exibições por TV e mídia.
-- O player envia contadores agregados (não um registro por exibição) a cada ~5 min.
CREATE TABLE IF NOT EXISTS public.play_logs (
  tv_id uuid NOT NULL,
  media_id uuid NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Maceio')::date,
  plays integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tv_id, media_id, day)
);

ALTER TABLE public.play_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.play_logs TO authenticated;
GRANT ALL ON public.play_logs TO service_role;

DROP POLICY IF EXISTS "play logs auth read" ON public.play_logs;
CREATE POLICY "play logs auth read" ON public.play_logs
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- _items: [{"m":"<media_id>","n":<qtde>}, ...]
CREATE OR REPLACE FUNCTION public.log_plays(_tv uuid, _items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it jsonb;
  cnt integer;
  today date := (now() AT TIME ZONE 'America/Maceio')::date;
BEGIN
  IF _tv IS NULL OR jsonb_typeof(_items) <> 'array' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tvs WHERE id = _tv) THEN RETURN; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LIMIT 200 LOOP
    BEGIN
      cnt := LEAST(GREATEST((it->>'n')::integer, 0), 5000);
      IF cnt > 0 THEN
        INSERT INTO public.play_logs (tv_id, media_id, day, plays)
        VALUES (_tv, (it->>'m')::uuid, today, cnt)
        ON CONFLICT (tv_id, media_id, day)
        DO UPDATE SET plays = public.play_logs.plays + EXCLUDED.plays, updated_at = now();
      END IF;
    EXCEPTION WHEN others THEN
      CONTINUE; -- item inválido não derruba o lote
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.log_plays(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_plays(uuid, jsonb) TO anon, authenticated, service_role;
