
-- 1) TV control columns
ALTER TABLE public.tvs
  ADD COLUMN IF NOT EXISTS orientation text NOT NULL DEFAULT 'landscape',
  ADD COLUMN IF NOT EXISTS layout_mode text NOT NULL DEFAULT 'fullscreen',
  ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ticker_text text,
  ADD COLUMN IF NOT EXISTS qr_url text,
  ADD COLUMN IF NOT EXISTS screen_resolution text,
  ADD COLUMN IF NOT EXISTS memory_usage text,
  ADD COLUMN IF NOT EXISTS command jsonb,
  ADD COLUMN IF NOT EXISTS event_mode boolean NOT NULL DEFAULT false;

GRANT SELECT (id, name, is_paired, playlist_id, is_live_active, last_ping, created_at,
              orientation, layout_mode, muted, ticker_text, qr_url, command, event_mode)
  ON public.tvs TO anon;

-- 2) Event photos wall
CREATE TABLE IF NOT EXISTS public.event_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  storage_path text,
  status text NOT NULL DEFAULT 'pending',
  featured boolean NOT NULL DEFAULT false,
  device_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT (id, image_url, status, featured, created_at) ON public.event_photos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_photos TO authenticated;
GRANT ALL ON public.event_photos TO service_role;

ALTER TABLE public.event_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event photos approved read" ON public.event_photos;
CREATE POLICY "event photos approved read" ON public.event_photos
  FOR SELECT TO anon USING (status = 'approved');

DROP POLICY IF EXISTS "event photos auth read" ON public.event_photos;
CREATE POLICY "event photos auth read" ON public.event_photos
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "event photos auth update" ON public.event_photos;
CREATE POLICY "event photos auth update" ON public.event_photos
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "event photos auth delete" ON public.event_photos;
CREATE POLICY "event photos auth delete" ON public.event_photos
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- 3) VIP alerts
CREATE TABLE IF NOT EXISTS public.tv_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tv_alerts TO anon;
GRANT SELECT, INSERT, DELETE ON public.tv_alerts TO authenticated;
GRANT ALL ON public.tv_alerts TO service_role;

ALTER TABLE public.tv_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tv alerts active read" ON public.tv_alerts;
CREATE POLICY "tv alerts active read" ON public.tv_alerts
  FOR SELECT TO anon, authenticated USING (expires_at > now());

DROP POLICY IF EXISTS "tv alerts auth insert" ON public.tv_alerts;
CREATE POLICY "tv alerts auth insert" ON public.tv_alerts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "tv alerts auth delete" ON public.tv_alerts;
CREATE POLICY "tv alerts auth delete" ON public.tv_alerts
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- 4) Public submission with per-device rate limit (3 per 5 minutes)
CREATE OR REPLACE FUNCTION public.submit_event_photo(
  _image_url text,
  _storage_path text,
  _device_hash text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recent int;
  _moderated boolean;
  _id uuid;
BEGIN
  IF _device_hash IS NULL OR length(_device_hash) < 8 THEN
    RAISE EXCEPTION 'device inválido';
  END IF;

  SELECT count(*) INTO _recent
  FROM public.event_photos
  WHERE device_hash = _device_hash
    AND created_at > now() - interval '5 minutes';

  IF _recent >= 3 THEN
    RAISE EXCEPTION 'rate_limit';
  END IF;

  SELECT bool_or(event_mode) INTO _moderated FROM public.tvs;

  INSERT INTO public.event_photos (image_url, storage_path, status, device_hash)
  VALUES (_image_url, _storage_path, 'pending', _device_hash)
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_event_photo(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_event_photo(text, text, text) TO anon, authenticated;

-- 5) updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS update_event_photos_updated_at ON public.event_photos;
CREATE TRIGGER update_event_photos_updated_at
  BEFORE UPDATE ON public.event_photos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Realtime
ALTER TABLE public.event_photos REPLICA IDENTITY FULL;
ALTER TABLE public.tv_alerts REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.event_photos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tv_alerts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tvs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
