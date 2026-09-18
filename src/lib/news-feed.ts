// Serviço de notícias (servidor): monta URLs do Google News RSS, faz parse, deduplica,
// pontua por relevância para a Center Frios (Trilha A: equipamentos/refrigeração comercial)
// e devolve as manchetes já ordenadas. Sem dependências (roda no worker).

export type NewsQuery = { q: string; weight: number };
export type NewsHeadline = { title: string; source: string; link: string; publishedAt: string; score: number };

export const DEFAULT_NEWS_QUERIES: NewsQuery[] = [
  // Peso 3 — núcleo do negócio
  { weight: 3, q: '("refrigeração comercial" OR "câmara fria" OR "balcão refrigerado" OR "expositor refrigerado" OR "freezer comercial") when:14d' },
  { weight: 3, q: '(equipamentos OR máquinas) (padaria OR açougue OR restaurante OR "food service") when:14d' },
  // Peso 2 — clientes diretos, custos e regulação
  { weight: 2, q: '("tarifa de energia" OR "conta de luz" OR "bandeira tarifária") (comércio OR supermercados OR restaurantes) when:7d' },
  { weight: 2, q: '(padarias OR panificação OR confeitaria) (Abip OR faturamento OR mercado OR tendências) when:7d' },
  { weight: 2, q: '(açougue OR frigorífico OR "carne bovina") (varejo OR mercado OR preço) when:7d' },
  { weight: 2, q: '(bares OR restaurantes OR pizzarias OR lanchonetes) (Abrasel OR faturamento OR movimento) when:7d' },
  { weight: 2, q: '("food service" OR foodservice) (mercado OR tendências OR investimento) when:7d' },
  { weight: 2, q: '(supermercados OR atacarejo) (ABRAS OR vendas OR expansão) when:7d' },
  { weight: 2, q: '(Alagoas OR Maceió) (restaurantes OR supermercados OR padarias OR bares) (faturamento OR vendas OR consumo OR mercado OR preço) when:7d' },
  { weight: 2, q: '("vigilância sanitária" OR "segurança dos alimentos") (restaurantes OR açougues OR padarias) when:14d' },
  // Peso 1 — contexto geral
  { weight: 1, q: '(empreendedorismo OR "pequenas empresas") (alimentação OR comércio) when:14d' },
  { weight: 1, q: '(Selic OR crédito OR financiamento) (equipamentos OR "pequenas empresas") when:14d' },
  { weight: 1, q: '("consumo fora do lar" OR delivery OR iFood) when:7d' },
  { weight: 1, q: 'inflação alimentos IPCA when:7d' },
];

// Concorrentes (conforme a Center Frios) + ruído comum.
export const DEFAULT_NEWS_EXCLUDE: string[] = [
  "Kents & Frios",
  "Kents e Frios",
  "Master Frio",
  "Casa do Panificador",
  "Central do Açougueiro",
  "horóscopo",
  "BBB",
  "futebol",
  "cupom",
  // Ruído recorrente (crime, acidentes, vagas, política local, fontes estrangeiras)
  "incêndio", "desaparec", "corpo de", "polícia", "preso", "assassin", "acidente", "morre",
  "vagas", "emprego", "vereador", "prefeitura", "restaurante popular", "vietnam", "inauguração do", "instagram.com", "refill", "ofertas",
];

// Termos no título que indicam proximidade com o core e ganham bônus.
const CORE_TERMS = [
  "refrigera", "câmara fria", "camara fria", "balcão", "balcao", "expositor", "freezer",
  "padaria", "panifica", "confeitaria", "açougue", "acougue", "frigorífic", "frigorific",
  "restaurante", "pizzaria", "lanchonete", "food service", "foodservice", "supermercado",
  "atacarejo", "equipamento", "energia", "alagoas", "maceió", "maceio",
];

const STRONG_TERMS = [
  "refrigera", "câmara fria", "camara fria", "balcão", "balcao", "expositor", "freezer", "equipamento",
  "energia", "frigorífic", "frigorific", "food service", "foodservice", "atacarejo", "supermercado",
];

// Além dos termos acima, aceita contexto de negócio/mercado (evita manchetes soltas).
const CONTEXT_TERMS = [
  "varejo", "consumo", "inflação", "selic", "tarifa", "abrasel", "abip", "abras",
  "faturamento", "food", "franquia", "delivery", "ifood", "sanitária", "empreend", "pequenas empresas",
  "preço", "mercado",
];

export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildNewsUrl(q: string): string {
  return (
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(q) +
    "&hl=pt-BR&gl=BR&ceid=BR:pt-BR"
  );
}

// Linhas "peso|consulta" (peso 1-3, opcional; padrão 2).
export function parseQueryLines(text: string | null | undefined): NewsQuery[] {
  const out: NewsQuery[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([1-3])\s*\|\s*(.+)$/);
    out.push(m ? { weight: parseInt(m[1], 10), q: m[2].trim() } : { weight: 2, q: line });
  }
  return out;
}

export function parseExcludeLines(text: string | null | undefined): string[] {
  return String(text || "")
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}

export function parseRss(xml: string): Omit<NewsHeadline, "score">[] {
  const items: Omit<NewsHeadline, "score">[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    let title = tag(block, "title");
    let source = tag(block, "source");
    // Google News: "Manchete - Fonte"
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    else if (!source) {
      const i = title.lastIndexOf(" - ");
      if (i > 0) {
        source = title.slice(i + 3);
        title = title.slice(0, i);
      }
    }
    const pub = tag(block, "pubDate");
    const t = Date.parse(pub);
    if (!title) continue;
    items.push({
      title: title.trim(),
      source: source.trim(),
      link: tag(block, "link"),
      publishedAt: isNaN(t) ? "" : new Date(t).toISOString(),
    });
  }
  return items;
}

function tokens(title: string): Set<string> {
  return new Set(norm(title).split(" ").filter((w) => w.length > 3));
}

function similar(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  let common = 0;
  a.forEach((w) => {
    if (b.has(w)) common++;
  });
  return common / Math.min(a.size, b.size) >= 0.6;
}

export function rankHeadlines(
  batches: { weight: number; items: Omit<NewsHeadline, "score">[] }[],
  exclude: string[],
  limit: number,
  maxPerSource = 3,
  now = Date.now(),
): NewsHeadline[] {
  const ex = exclude.map(norm).filter(Boolean);
  const pool: (NewsHeadline & { tk: Set<string> })[] = [];
  for (const b of batches) {
    for (const it of b.items) {
      const hay = norm(it.title + " " + it.source);
      if (ex.some((e) => hay.includes(e))) continue;
      const ageH = it.publishedAt ? Math.max(0, (now - Date.parse(it.publishedAt)) / 36e5) : 168;
      const recency = Math.max(0, 1 - ageH / 168); // 0..1 na janela de 7 dias
      const nt = norm(it.title);
      let bonus = 0;
      for (const c of CORE_TERMS) if (nt.includes(norm(c))) bonus += 0.4;
      // Só setor genérico ("restaurante", "padaria") não basta: exige termo forte ou contexto de negócio.
      const strong = STRONG_TERMS.some((c) => nt.includes(norm(c)));
      if (!strong && !CONTEXT_TERMS.some((c) => nt.includes(norm(c)))) continue;
      const score = b.weight * 3 + recency * 3 + Math.min(bonus, 1.6);
      pool.push({ ...it, score, tk: tokens(it.title) });
    }
  }
  pool.sort((x, y) => y.score - x.score);

  const picked: (NewsHeadline & { tk: Set<string> })[] = [];
  const perSource: Record<string, number> = {};
  const seenLinks = new Set<string>();
  for (const it of pool) {
    if (picked.length >= limit) break;
    if (it.link && seenLinks.has(it.link)) continue;
    if (picked.some((p) => similar(p.tk, it.tk))) continue;
    const sk = norm(it.source);
    if ((perSource[sk] || 0) >= maxPerSource) continue;
    perSource[sk] = (perSource[sk] || 0) + 1;
    if (it.link) seenLinks.add(it.link);
    picked.push(it);
  }
  // Exibição: mais recentes primeiro entre os selecionados
  picked.sort((x, y) => Date.parse(y.publishedAt || "0") - Date.parse(x.publishedAt || "0"));
  return picked.map(({ tk: _tk, ...rest }) => rest);
}
