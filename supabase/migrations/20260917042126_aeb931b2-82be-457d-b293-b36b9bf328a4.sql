ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS show_weather boolean NOT NULL DEFAULT false;

ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS show_currency boolean NOT NULL DEFAULT false;

GRANT SELECT (show_weather, show_currency) ON public.tvs TO anon;