-- 1) event_photos: leitura ampla apenas para administradores
DROP POLICY IF EXISTS "event photos auth read" ON public.event_photos;
CREATE POLICY "event photos admin read"
  ON public.event_photos FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) tv_alerts: somente administradores podem criar/apagar alertas
DROP POLICY IF EXISTS "tv alerts auth insert" ON public.tv_alerts;
DROP POLICY IF EXISTS "tv alerts auth delete" ON public.tv_alerts;
CREATE POLICY "tv alerts admin insert"
  ON public.tv_alerts FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "tv alerts admin delete"
  ON public.tv_alerts FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) tvs: separar leitura anônima (players) da leitura administrativa
DROP POLICY IF EXISTS "tvs read" ON public.tvs;

CREATE POLICY "tvs read authenticated"
  ON public.tvs FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Players só enxergam telas que fizeram ping recente (a própria tela, logo após register_tv/heartbeat)
CREATE POLICY "tvs read active players"
  ON public.tvs FOR SELECT
  TO anon
  USING (last_ping IS NOT NULL AND last_ping > (now() - '00:10:00'::interval));

-- Trava de colunas: anon nunca recebe pairing_code, live_stream_url, memory_usage,
-- screen_resolution nem colunas futuras adicionadas à tabela.
REVOKE ALL ON public.tvs FROM anon;
GRANT SELECT (
  id, name, is_paired, playlist_id, is_live_active, last_ping, created_at,
  orientation, layout_mode, muted, ticker_text, qr_url, command, event_mode
) ON public.tvs TO anon;