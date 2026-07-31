
CREATE OR REPLACE FUNCTION public.tv_heartbeat(
  _id uuid,
  _resolution text DEFAULT NULL,
  _memory text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.tvs
  SET last_ping = now(),
      screen_resolution = COALESCE(_resolution, screen_resolution),
      memory_usage = COALESCE(_memory, memory_usage)
  WHERE id = _id;
$$;

REVOKE ALL ON FUNCTION public.tv_heartbeat(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tv_heartbeat(uuid, text, text) TO anon, authenticated;
