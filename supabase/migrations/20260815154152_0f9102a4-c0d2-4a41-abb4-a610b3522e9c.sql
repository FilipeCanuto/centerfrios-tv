
-- event_photos
DROP POLICY IF EXISTS "event photos auth update" ON public.event_photos;
DROP POLICY IF EXISTS "event photos auth delete" ON public.event_photos;
CREATE POLICY "event photos admin update" ON public.event_photos FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "event photos admin delete" ON public.event_photos FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- media
DROP POLICY IF EXISTS "media insert auth" ON public.media;
DROP POLICY IF EXISTS "media update auth" ON public.media;
DROP POLICY IF EXISTS "media delete auth" ON public.media;
CREATE POLICY "media insert admin" ON public.media FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "media update admin" ON public.media FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "media delete admin" ON public.media FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- playlists
DROP POLICY IF EXISTS "playlists insert auth" ON public.playlists;
DROP POLICY IF EXISTS "playlists update auth" ON public.playlists;
DROP POLICY IF EXISTS "playlists delete auth" ON public.playlists;
CREATE POLICY "playlists insert admin" ON public.playlists FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "playlists update admin" ON public.playlists FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "playlists delete admin" ON public.playlists FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- live_frames
DROP POLICY IF EXISTS "live frames insert auth" ON public.live_frames;
DROP POLICY IF EXISTS "live frames delete auth" ON public.live_frames;
CREATE POLICY "live frames insert admin" ON public.live_frames FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "live frames delete admin" ON public.live_frames FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- tvs
DROP POLICY IF EXISTS "tvs insert auth" ON public.tvs;
DROP POLICY IF EXISTS "tvs update auth" ON public.tvs;
DROP POLICY IF EXISTS "tvs delete auth" ON public.tvs;
DROP POLICY IF EXISTS "tvs read authenticated" ON public.tvs;
CREATE POLICY "tvs insert admin" ON public.tvs FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "tvs update admin" ON public.tvs FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "tvs delete admin" ON public.tvs FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "tvs read admin" ON public.tvs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- storage: media bucket
DROP POLICY IF EXISTS "media auth insert" ON storage.objects;
DROP POLICY IF EXISTS "media auth update" ON storage.objects;
DROP POLICY IF EXISTS "media auth delete" ON storage.objects;
DROP POLICY IF EXISTS "media auth read" ON storage.objects;
CREATE POLICY "media admin insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media' AND public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "media admin update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'media' AND public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (bucket_id = 'media' AND public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "media admin delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'media' AND public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "media admin read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'media' AND public.has_role(auth.uid(), 'admin'::app_role));

-- storage: event-photos bucket
DROP POLICY IF EXISTS "event photos auth read" ON storage.objects;
DROP POLICY IF EXISTS "event photos auth delete" ON storage.objects;
CREATE POLICY "event photos admin read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'event-photos' AND public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "event photos admin delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'event-photos' AND public.has_role(auth.uid(), 'admin'::app_role));
