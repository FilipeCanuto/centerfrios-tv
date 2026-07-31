CREATE OR REPLACE FUNCTION public.register_tv(_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _id uuid;
BEGIN
  IF _code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  INSERT INTO public.tvs (pairing_code, name, last_ping)
  VALUES (_code, 'TV ' || _code, now())
  ON CONFLICT (pairing_code) DO UPDATE SET last_ping = now()
  RETURNING id INTO _id;

  IF _id IS NULL THEN
    SELECT id INTO _id FROM public.tvs WHERE pairing_code = _code;
  END IF;

  RETURN _id;
END;
$function$;