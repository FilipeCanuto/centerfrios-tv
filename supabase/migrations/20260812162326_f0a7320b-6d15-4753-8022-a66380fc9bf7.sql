ALTER TABLE public.tvs
  ADD COLUMN IF NOT EXISTS volume integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS ticker_position text NOT NULL DEFAULT 'bottom',
  ADD COLUMN IF NOT EXISTS qr_position text NOT NULL DEFAULT 'top-right',
  ADD COLUMN IF NOT EXISTS media_fit text NOT NULL DEFAULT 'contain',
  ADD COLUMN IF NOT EXISTS sponsors_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS countdown_label text,
  ADD COLUMN IF NOT EXISTS countdown_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_message text,
  ADD COLUMN IF NOT EXISTS welcome_until timestamptz;

ALTER TABLE public.tvs
  ADD CONSTRAINT tvs_volume_range CHECK (volume >= 0 AND volume <= 100);

ALTER TABLE public.event_photos
  ADD COLUMN IF NOT EXISTS featured_until timestamptz;

GRANT SELECT (volume, ticker_position, qr_position, media_fit, sponsors_enabled, countdown_label, countdown_ends_at, welcome_message, welcome_until) ON public.tvs TO anon;
GRANT SELECT (featured_until) ON public.event_photos TO anon;

CREATE TABLE IF NOT EXISTS public.event_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  image_url text NOT NULL,
  storage_path text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.event_sponsors TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_sponsors TO authenticated;
GRANT ALL ON public.event_sponsors TO service_role;

ALTER TABLE public.event_sponsors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event sponsors public read active"
  ON public.event_sponsors FOR SELECT TO anon, authenticated
  USING (active = true);

CREATE POLICY "event sponsors admin manage"
  ON public.event_sponsors FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_event_sponsors_updated_at
  BEFORE UPDATE ON public.event_sponsors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.event_sponsors;