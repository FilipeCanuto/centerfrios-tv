-- ROLES
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- MEDIA
CREATE TABLE public.media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  storage_path text,
  type text NOT NULL DEFAULT 'image',
  duration integer NOT NULL DEFAULT 10,
  file_size bigint,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media TO authenticated;
GRANT SELECT ON public.media TO anon;
GRANT ALL ON public.media TO service_role;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "media public read" ON public.media FOR SELECT USING (true);
CREATE POLICY "media auth write" ON public.media FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PLAYLISTS
CREATE TABLE public.playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlists TO authenticated;
GRANT SELECT ON public.playlists TO anon;
GRANT ALL ON public.playlists TO service_role;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "playlists public read" ON public.playlists FOR SELECT USING (true);
CREATE POLICY "playlists auth write" ON public.playlists FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- TVS
CREATE TABLE public.tvs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Nova TV',
  pairing_code text NOT NULL UNIQUE,
  is_paired boolean NOT NULL DEFAULT false,
  playlist_id uuid REFERENCES public.playlists(id) ON DELETE SET NULL,
  is_live_active boolean NOT NULL DEFAULT false,
  live_stream_url text,
  last_ping timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tvs TO authenticated;
GRANT SELECT ON public.tvs TO anon;
GRANT ALL ON public.tvs TO service_role;
ALTER TABLE public.tvs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tvs public read" ON public.tvs FOR SELECT USING (true);
CREATE POLICY "tvs auth write" ON public.tvs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- LIVE FRAMES
CREATE TABLE public.live_frames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frame_data text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_frames TO authenticated;
GRANT SELECT ON public.live_frames TO anon;
GRANT ALL ON public.live_frames TO service_role;
ALTER TABLE public.live_frames ENABLE ROW LEVEL SECURITY;
CREATE POLICY "live frames public read" ON public.live_frames FOR SELECT USING (true);
CREATE POLICY "live frames auth write" ON public.live_frames FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- TV self-registration + ping (security definer, no anon write policies needed)
CREATE OR REPLACE FUNCTION public.register_tv(_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF _code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'invalid code';
  END IF;
  SELECT id INTO _id FROM public.tvs WHERE pairing_code = _code;
  IF _id IS NULL THEN
    INSERT INTO public.tvs (pairing_code, name, last_ping)
    VALUES (_code, 'TV ' || _code, now())
    RETURNING id INTO _id;
  ELSE
    UPDATE public.tvs SET last_ping = now() WHERE id = _id;
  END IF;
  RETURN _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_tv(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.tv_ping(_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.tvs SET last_ping = now() WHERE id = _id;
$$;
GRANT EXECUTE ON FUNCTION public.tv_ping(uuid) TO anon, authenticated;

-- REALTIME
ALTER TABLE public.tvs REPLICA IDENTITY FULL;
ALTER TABLE public.live_frames REPLICA IDENTITY FULL;
ALTER TABLE public.playlists REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tvs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_frames;
ALTER PUBLICATION supabase_realtime ADD TABLE public.playlists;