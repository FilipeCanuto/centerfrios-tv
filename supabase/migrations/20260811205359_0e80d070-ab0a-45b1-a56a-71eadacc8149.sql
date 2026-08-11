ALTER TABLE public.media ADD COLUMN IF NOT EXISTS qr_url text;

CREATE TABLE public.app_settings (
  id text PRIMARY KEY DEFAULT 'global',
  auto_publish boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert settings" ON public.app_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update settings" ON public.app_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings (id, auto_publish) VALUES ('global', false);

CREATE TABLE public.alert_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  duration_seconds integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_templates TO authenticated;
GRANT ALL ON public.alert_templates TO service_role;
ALTER TABLE public.alert_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage alert templates" ON public.alert_templates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_alert_templates_updated_at BEFORE UPDATE ON public.alert_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.submit_event_photo(_image_url text, _storage_path text, _device_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent integer;
  new_id uuid;
  auto boolean;
BEGIN
  IF _device_hash IS NULL OR length(_device_hash) < 8 THEN
    RAISE EXCEPTION 'invalid device';
  END IF;

  SELECT count(*) INTO recent
  FROM public.event_photos
  WHERE device_hash = _device_hash
    AND created_at > now() - interval '5 minutes';

  IF recent >= 3 THEN
    RAISE EXCEPTION 'rate_limit';
  END IF;

  SELECT auto_publish INTO auto FROM public.app_settings WHERE id = 'global';

  INSERT INTO public.event_photos (image_url, storage_path, device_hash, status)
  VALUES (_image_url, _storage_path, _device_hash, CASE WHEN coalesce(auto, false) THEN 'approved' ELSE 'pending' END)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_event_photo(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_event_photo(text, text, text) TO anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;