-- Rodapé de notícias (Multi-zona) + toggle/tamanho independentes da logomarca.
-- news_queries / news_exclude: uma entrada por linha; NULL = padrão do servidor.
ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS show_logo boolean NOT NULL DEFAULT true;
ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS logo_size integer NOT NULL DEFAULT 48;
ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS show_news_ticker boolean NOT NULL DEFAULT false;
ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS news_queries text;
ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS news_exclude text;
ALTER TABLE public.tvs ADD COLUMN IF NOT EXISTS news_interval_min integer NOT NULL DEFAULT 30;
GRANT SELECT (show_logo, logo_size, show_news_ticker, news_queries, news_exclude, news_interval_min) ON public.tvs TO anon;