CREATE OR REPLACE FUNCTION public.get_tv_playlist_items(p_playlist_id uuid)
RETURNS TABLE (
  media_id uuid,
  title text,
  url text,
  type text,
  duration integer,
  qr_url text,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id,
         m.title,
         m.url,
         m.type,
         COALESCE(NULLIF((it.value->>'custom_duration')::int, 0), NULLIF(m.duration, 0), 10),
         m.qr_url,
         it.ord::int
  FROM public.playlists p
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.items, '[]'::jsonb)) WITH ORDINALITY AS it(value, ord)
  JOIN public.media m ON m.id = (it.value->>'media_id')::uuid
  WHERE p.id = p_playlist_id
  ORDER BY COALESCE((it.value->>'order')::int, it.ord::int), it.ord;
$$;

REVOKE ALL ON FUNCTION public.get_tv_playlist_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tv_playlist_items(uuid) TO anon, authenticated, service_role;