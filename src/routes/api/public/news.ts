// Endpoint público: /api/public/news
// Busca manchetes no Google News RSS (sem CORS no navegador → feito no servidor),
// deduplica, pontua e devolve { items: [{ text, source }], updatedAt }.
// Parâmetros opcionais: queries (linhas "peso|consulta" separadas por \n), exclude (\n ou ,), limit.
import { createFileRoute } from "@tanstack/react-router";
import {
  DEFAULT_NEWS_EXCLUDE,
  DEFAULT_NEWS_QUERIES,
  buildNewsUrl,
  parseExcludeLines,
  parseQueryLines,
  parseRss,
  rankHeadlines,
} from "@/lib/news-feed";

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

async function fetchRss(q: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(buildNewsUrl(q), { signal: ctrl.signal });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

export const Route = createFileRoute("/api/public/news")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sp = new URL(request.url).searchParams;
        const custom = parseQueryLines(sp.get("queries"));
        const queries = (custom.length ? custom : DEFAULT_NEWS_QUERIES).slice(0, 20);
        const extra = parseExcludeLines(sp.get("exclude"));
        const exclude = Array.from(new Set([...DEFAULT_NEWS_EXCLUDE, ...extra]));
        const limit = Math.min(30, Math.max(5, parseInt(sp.get("limit") || "18", 10) || 18));

        const key = JSON.stringify([queries, exclude, limit]);
        const hit = cache.get(key);
        const headers = { "Cache-Control": "public, max-age=300" };
        if (hit && Date.now() - hit.at < CACHE_MS) return Response.json(hit.body, { headers });

        try {
          const xmls = await Promise.all(queries.map((q) => fetchRss(q.q)));
          const batches = xmls.map((xml, i) => ({
            weight: queries[i].weight,
            items: parseRss(xml),
          }));
          const ranked = rankHeadlines(batches, exclude, limit);
          if (!ranked.length) {
            if (hit) return Response.json(hit.body, { headers });
            return Response.json({ error: "Sem manchetes no momento" }, { status: 502 });
          }
          const body = {
            items: ranked.map((h) => ({ text: h.title, source: h.source })),
            updatedAt: new Date().toISOString(),
          };
          cache.set(key, { at: Date.now(), body });
          return Response.json(body, { headers });
        } catch (err) {
          if (hit) return Response.json(hit.body, { headers });
          return Response.json({ error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
