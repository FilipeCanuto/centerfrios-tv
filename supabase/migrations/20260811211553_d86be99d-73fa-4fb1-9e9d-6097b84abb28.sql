ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS device_uuid text;
CREATE UNIQUE INDEX IF NOT EXISTS tvs_device_uuid_key ON public.tvs (device_uuid) WHERE device_uuid IS NOT NULL;

CREATE OR REPLACE FUNCTION public.register_tv_device(_device_uuid text, _code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tv public.tvs%ROWTYPE;
  _new_code text;
  _tries int := 0;
BEGIN
  IF _device_uuid IS NULL OR length(_device_uuid) < 8 THEN
    RAISE EXCEPTION 'invalid device';
  END IF;

  SELECT * INTO _tv FROM public.tvs WHERE device_uuid = _device_uuid;
  IF FOUND THEN
    UPDATE public.tvs SET last_ping = now() WHERE id = _tv.id;
    RETURN jsonb_build_object('id', _tv.id, 'code', _tv.pairing_code);
  END IF;

  -- adota registro criado antes do device_uuid (mesmo codigo, ainda sem aparelho)
  IF _code ~ '^[0-9]{6}$' THEN
    SELECT * INTO _tv FROM public.tvs WHERE pairing_code = _code AND device_uuid IS NULL;
    IF FOUND THEN
      UPDATE public.tvs SET device_uuid = _device_uuid, last_ping = now() WHERE id = _tv.id;
      RETURN jsonb_build_object('id', _tv.id, 'code', _tv.pairing_code);
    END IF;
  END IF;

  IF _code ~ '^[0-9]{6}$' AND NOT EXISTS (SELECT 1 FROM public.tvs WHERE pairing_code = _code) THEN
    _new_code := _code;
  ELSE
    LOOP
      _tries := _tries + 1;
      _new_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tvs WHERE pairing_code = _new_code) OR _tries > 50;
    END LOOP;
  END IF;

  INSERT INTO public.tvs (pairing_code, name, last_ping, device_uuid)
  VALUES (_new_code, 'TV ' || _new_code, now(), _device_uuid)
  ON CONFLICT (device_uuid) DO UPDATE SET last_ping = now()
  RETURNING * INTO _tv;

  RETURN jsonb_build_object('id', _tv.id, 'code', _tv.pairing_code);
END;
$$;

REVOKE ALL ON FUNCTION public.register_tv_device(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.register_tv_device(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_ghost_tvs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH del AS (
    DELETE FROM public.tvs
    WHERE (last_ping IS NULL OR last_ping < now() - interval '10 minutes')
      AND playlist_id IS NULL
      AND is_paired = false
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM del;

  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_ghost_tvs() FROM public;
GRANT EXECUTE ON FUNCTION public.cleanup_ghost_tvs() TO authenticated;