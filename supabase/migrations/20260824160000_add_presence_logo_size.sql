ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS presence_logo_size integer DEFAULT 96;
GRANT SELECT (presence_logo_size) ON public.tvs TO anon;
