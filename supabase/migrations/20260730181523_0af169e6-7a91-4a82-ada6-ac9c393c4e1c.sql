-- TVS
DROP POLICY IF EXISTS "tvs auth write" ON public.tvs;
DROP POLICY IF EXISTS "tvs public read" ON public.tvs;

CREATE POLICY "tvs read" ON public.tvs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "tvs insert auth" ON public.tvs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "tvs update auth" ON public.tvs FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "tvs delete auth" ON public.tvs FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.tvs FROM anon;
GRANT SELECT (id, name, is_paired, playlist_id, is_live_active, last_ping, created_at) ON public.tvs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tvs TO authenticated;
GRANT ALL ON public.tvs TO service_role;

-- MEDIA
DROP POLICY IF EXISTS "media auth write" ON public.media;
DROP POLICY IF EXISTS "media public read" ON public.media;

CREATE POLICY "media read" ON public.media FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "media insert auth" ON public.media FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "media update auth" ON public.media FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "media delete auth" ON public.media FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.media FROM anon;
GRANT SELECT (id, title, url, type, duration, created_at) ON public.media TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media TO authenticated;
GRANT ALL ON public.media TO service_role;

-- PLAYLISTS
DROP POLICY IF EXISTS "playlists auth write" ON public.playlists;
DROP POLICY IF EXISTS "playlists public read" ON public.playlists;

CREATE POLICY "playlists read" ON public.playlists FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "playlists insert auth" ON public.playlists FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "playlists update auth" ON public.playlists FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "playlists delete auth" ON public.playlists FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.playlists FROM anon;
GRANT SELECT (id, name, items, created_at) ON public.playlists TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlists TO authenticated;
GRANT ALL ON public.playlists TO service_role;

-- LIVE FRAMES
DROP POLICY IF EXISTS "live frames auth write" ON public.live_frames;
DROP POLICY IF EXISTS "live frames public read" ON public.live_frames;

CREATE POLICY "live frames recent read" ON public.live_frames FOR SELECT TO anon, authenticated
  USING (created_at > (now() - interval '2 minutes'));
CREATE POLICY "live frames insert auth" ON public.live_frames FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "live frames delete auth" ON public.live_frames FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.live_frames FROM anon;
GRANT SELECT (id, frame_data, created_at) ON public.live_frames TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_frames TO authenticated;
GRANT ALL ON public.live_frames TO service_role;

-- FUNCTION EXECUTION PRIVILEGES
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.register_tv(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.register_tv(text) TO anon, service_role;

REVOKE ALL ON FUNCTION public.tv_ping(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_ping(uuid) TO anon, service_role;