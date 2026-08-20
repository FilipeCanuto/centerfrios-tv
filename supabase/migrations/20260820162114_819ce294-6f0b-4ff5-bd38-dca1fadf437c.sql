CREATE TABLE public.event_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text NOT NULL,
  company text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.event_checkins TO anon;
GRANT SELECT, INSERT ON public.event_checkins TO authenticated;
GRANT ALL ON public.event_checkins TO service_role;

ALTER TABLE public.event_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event checkins public insert" ON public.event_checkins
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(btrim(full_name)) BETWEEN 2 AND 120
    AND length(btrim(phone)) BETWEEN 8 AND 30
    AND length(btrim(company)) BETWEEN 2 AND 120
  );

CREATE POLICY "event checkins admin read" ON public.event_checkins
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "event checkins admin delete" ON public.event_checkins
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.tvs
  ADD COLUMN IF NOT EXISTS show_presence_qr boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS presence_qr_position text NOT NULL DEFAULT 'bottom-right';

ALTER PUBLICATION supabase_realtime ADD TABLE public.event_checkins;