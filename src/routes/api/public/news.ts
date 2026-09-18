// Endpoint público: /api/public/news
// Busca manchetes no Google News RSS (sem CORS no navegador → feito no servidor),
// deduplica, pontua e devolve { items: [{ text, source }], updatedAt }.
// Parâmetros opcionais: queries (linhas "peso|consulta" separadas por \n), exclude (\n ou ,), limit.
import { createFileRoute } from "@tanstack/react-router";
import {
  DEFAULT_NEWS_EXCLUDE,
  DEFAULT_NEWS_QUERIES,
  buildBingNewsUrl,
  buildNewsUrl,
  parseExcludeLines,
  parseQueryLines,
  parseRss,
  rankHeadlines,
  simplifyForBing,
  type NewsQuery,
} from "@/lib/news-feed";

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();
let lastGood: unknown = null; // último resultado válido de qualquer combinação de buscas

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type Fetched = { xml: string; status: number };

async function fetchText(url: string): Promise<Fetched> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9", Accept: "application/rss+xml, text/xml, */*" },
    });
    return { xml: res.ok ? await res.text() : "", status: res.status };
  } catch {
    return { xml: "", status: 0 };
  } finally {
    clearTimeout(t);
  }
}

// Circuit breaker: o Google bloqueia IPs de datacenter com frequência. Após 3 falhas seguidas,
// pula o Google por 20 min (vai direto ao Bing) para não gastar tempo com timeouts.
let googleFails = 0;
let googleSkipUntil = 0;

async function bingItems(q: NewsQuery, diag: string[]) {
  const terms = (q.bing && q.bing.length ? q.bing : [simplifyForBing(q.q)]).filter(Boolean).slice(0, q.weight >= 3 ? 3 : 2);
  const batches = await Promise.all(terms.map((t) => fetchText(buildBingNewsUrl(t))));
  const items = batches.flatMap((b) => parseRss(b.xml));
  diag.push("b" + batches.map((b) => b.status).join(",") + ":" + items.length);
  return items;
}

// Google News primeiro; se bloqueado/vazio, Bing News.
async function fetchItems(q: NewsQuery, diag: string[]) {
  if (Date.now() >= googleSkipUntil) {
    const g = await fetchText(buildNewsUrl(q.q));
    const items = parseRss(g.xml);
    if (items.length) {
      googleFails = 0;
      diag.push("g" + g.status + ":" + items.length);
      return items;
    }
    if (g.status === 0 || g.status === 429 || g.status >= 500) {
      if (++googleFails >= 3) googleSkipUntil = Date.now() + 20 * 60 * 1000;
    }
    diag.push("g" + g.status);
  }
  return bingItems(q, diag);
}

// Executa com concorrência limitada para não disparar o rate limit do Google.
async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i]);
      }
    }),
  );
  return out;
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

        const diag: string[] = [];
        try {
          const results = await mapLimit(queries, 5, (q) => fetchItems(q, diag));
          const batches = results.map((items, i) => ({ weight: queries[i].weight, items }));
          const ranked = rankHeadlines(batches, exclude, limit);
          if (!ranked.length) {
            // Nada novo: serve o cache expirado ou o último resultado bom em vez de falhar.
            const stale = hit?.body ?? lastGood;
            if (stale) return Response.json(stale, { headers });
            return Response.json({ error: "Sem manchetes no momento", diag }, { status: 502 });
          }
          const body = {
            items: ranked.map((h) => ({ text: h.title, source: h.source })),
            updatedAt: new Date().toISOString(),
            ...(sp.get("debug") ? { diag } : {}),
          };
          cache.set(key, { at: Date.now(), body });
          lastGood = body;
          return Response.json(body, { headers });
        } catch (err) {
          const stale = hit?.body ?? lastGood;
          if (stale) return Response.json(stale, { headers });
          return Response.json({ error: String(err), diag }, { status: 500 });
        }
      },
    },
  },
});
