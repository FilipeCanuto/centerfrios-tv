DROP POLICY IF EXISTS "media read" ON public.media;
CREATE POLICY "media admin read" ON public.media FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "playlists read" ON public.playlists;
CREATE POLICY "playlists admin read" ON public.playlists FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated can read settings" ON public.app_settings;
CREATE POLICY "Admins can read settings" ON public.app_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- TVs (sem login) leem apenas os itens (com agendamento) de uma playlist específica
CREATE OR REPLACE FUNCTION public.get_tv_playlist_raw(p_playlist_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT items FROM public.playlists WHERE id = p_playlist_id
$$;
REVOKE ALL ON FUNCTION public.get_tv_playlist_raw(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tv_playlist_raw(uuid) TO anon, authenticated;