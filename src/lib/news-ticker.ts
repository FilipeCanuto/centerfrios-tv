// Cliente do rodapé de notícias: busca /api/public/news, mantém cache local (último válido)
// e expõe useNewsTicker() com a lista pronta para rotação (manchetes + texto manual intercalado).
import { useEffect, useMemo, useRef, useState } from "react";
import { readCache, writeCache, type NewsTickerItem } from "@/lib/centerfrios";

const CACHE_KEY = "cf_news_cache";
const PROMO_EVERY = 4; // texto manual a cada N manchetes

type Cached = { items: { text: string; source: string }[]; savedAt: number; sig: string };

function sigOf(queries: string | null, exclude: string | null) {
  return (queries || "") + "#" + (exclude || "");
}

export async function fetchNews(
  queries: string | null,
  exclude: string | null,
): Promise<{ text: string; source: string }[] | null> {
  const p = new URLSearchParams();
  if (queries) p.set("queries", queries);
  if (exclude) p.set("exclude", exclude);
  try {
    const res = await fetch("/api/public/news" + (p.toString() ? "?" + p.toString() : ""));
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.items) && data.items.length ? data.items : null;
  } catch {
    return null; // falha: o chamador mantém o último cache válido
  }
}

export function interleaveManual(
  headlines: { text: string; source: string }[],
  manual: string | null | undefined,
): NewsTickerItem[] {
  const out: NewsTickerItem[] = [];
  const m = (manual || "").trim();
  if (m) out.push({ text: m, source: "", promo: true });
  headlines.forEach((h, i) => {
    out.push({ text: h.text, source: h.source });
    if (m && (i + 1) % PROMO_EVERY === 0 && i + 1 < headlines.length) {
      out.push({ text: m, source: "", promo: true });
    }
  });
  return out;
}

export function useNewsTicker(opts: {
  enabled: boolean;
  queries: string | null;
  exclude: string | null;
  intervalMin: number;
  manualText: string | null;
}): NewsTickerItem[] {
  const { enabled, queries, exclude, intervalMin, manualText } = opts;
  const sig = sigOf(queries, exclude);
  const [headlines, setHeadlines] = useState<{ text: string; source: string }[]>(() => {
    const c = readCache<Cached>(CACHE_KEY);
    return c && c.sig === sig ? c.items : [];
  });

  const headlinesRef = useRef(headlines);
  headlinesRef.current = headlines;

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    async function load() {
      const items = await fetchNews(queries, exclude);
      if (stop) return;
      if (!items) {
        // Falhou: mantém o cache. Sem nada para mostrar, tenta de novo em 60 s.
        if (!headlinesRef.current.length && !retry) {
          retry = setTimeout(() => {
            retry = null;
            load();
          }, 60000);
        }
        return;
      }
      setHeadlines(items);
      writeCache(CACHE_KEY, { items, savedAt: Date.now(), sig } satisfies Cached);
    }
    load();
    const ms = Math.max(10, intervalMin || 30) * 60 * 1000;
    const t = setInterval(load, ms);
    return () => {
      stop = true;
      if (retry) clearTimeout(retry);
      clearInterval(t);
    };
  }, [enabled, queries, exclude, intervalMin, sig]);

  return useMemo(
    () => (enabled ? interleaveManual(headlines, manualText) : []),
    [enabled, headlines, manualText],
  );
}
