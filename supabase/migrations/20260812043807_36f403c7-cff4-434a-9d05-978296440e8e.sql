-- RPC pública: registra/reaproveita TV pelo device_uuid e devolve o codigo gerado no servidor
CREATE OR REPLACE FUNCTION public.register_tv_device(p_device_uuid text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tv public.tvs%ROWTYPE;
  _new_code text;
  _tries int := 0;
BEGIN
  IF p_device_uuid IS NULL OR length(p_device_uuid) < 8 THEN
    RAISE EXCEPTION 'invalid device';
  END IF;

  SELECT * INTO _tv FROM public.tvs WHERE device_uuid = p_device_uuid;

  IF FOUND THEN
    UPDATE public.tvs SET last_ping = now() WHERE id = _tv.id RETURNING * INTO _tv;
  ELSE
    LOOP
      _tries := _tries + 1;
      _new_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tvs WHERE pairing_code = _new_code) OR _tries > 50;
    END LOOP;

    INSERT INTO public.tvs (pairing_code, name, last_ping, device_uuid)
    VALUES (_new_code, 'TV ' || _new_code, now(), p_device_uuid)
    ON CONFLICT (device_uuid) DO UPDATE SET last_ping = now()
    RETURNING * INTO _tv;
  END IF;

  RETURN jsonb_build_object(
    'id', _tv.id,
    'pairing_code', _tv.pairing_code,
    'code', _tv.pairing_code,
    'name', _tv.name,
    'is_paired', _tv.is_paired,
    'playlist_id', _tv.playlist_id,
    'event_mode', _tv.event_mode,
    'is_live_active', _tv.is_live_active
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_tv_device(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_tv_device(text) TO anon, authenticated;
