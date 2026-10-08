// Endpoint público: /api/public/infobar
// Dados da barra de informações da TV, buscados no servidor (sem CORS no Silk, com cache):
// - Cotações: PTAX de FECHAMENTO do dia útil anterior (Banco Central do Brasil, cotação de venda).
//   Reserva: Banco Central Europeu (Frankfurter) do dia útil anterior.
// - Tempo em Maceió: temperatura MEDIDA na estação oficial do aeroporto de Maceió (METAR SBMO,
//   atualizada de hora em hora). Reserva: modelo Open-Meteo. Ícone/dia-noite: Open-Meteo.
// Resposta: { weather: { temp, code, isDay, source, at } | null, rates: { usd, eur, date, source } | null }
import { createFileRoute } from "@tanstack/react-router";

const TZ = "America/Maceio";
const LAT = -9.6498;
const LON = -35.7089;

type Weather = { temp: number; code: number | null; isDay: boolean; source: string; at: string };
type Rates = { usd: number; eur: number; date: string; source: string };

let weatherCache: { at: number; v: Weather } | null = null;
let ratesCache: { at: number; key: string; v: Rates } | null = null;
const WEATHER_MS = 10 * 60 * 1000;
const RATES_MS = 5 * 60 * 1000; // cotação ao vivo: 5 min de cache protege a rota e a AwesomeAPI

async function getJson(url: string, ms = 7000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    // User-Agent explícito: algumas APIs recusam pedidos sem ele vindos de servidores (Cloudflare Workers).
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "CenterfriosTV/1.0 (+https://centerfrios-tv.lovable.app)" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Data "AAAA-MM-DD" no fuso de Maceió.
function ymdLocal(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function shiftDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const toBcb = (ymd: string) => ymd.slice(5, 7) + "-" + ymd.slice(8, 10) + "-" + ymd.slice(0, 4); // MM-DD-AAAA

// Último fechamento PTAX ANTERIOR a hoje (dia útil anterior; pula fim de semana/feriado).
async function ptaxClose(moeda: "USD" | "EUR", today: string): Promise<{ v: number; date: string } | null> {
  const ini = toBcb(shiftDays(today, -10));
  const fim = toBcb(shiftDays(today, -1));
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@moeda='${moeda}'&@dataInicial='${ini}'&@dataFinalCotacao='${fim}'` +
    "&$format=json&$select=cotacaoVenda,dataHoraCotacao,tipoBoletim";
  const j = await getJson(url, 9000);
  const rows: any[] = Array.isArray(j?.value) ? j.value : [];
  const closes = rows
    .filter((r) => r && r.tipoBoletim === "Fechamento" && typeof r.cotacaoVenda === "number")
    .map((r) => ({ v: r.cotacaoVenda as number, date: String(r.dataHoraCotacao).slice(0, 10) }))
    .filter((r) => r.date < today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return closes.length ? closes[closes.length - 1] : null;
}

// Dia da semana em Maceió (0 = domingo, 6 = sábado).
function weekdayLocal(d = new Date()): number {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
}

// Cotação comercial AO VIVO (AwesomeAPI, preço de venda). Só vale em dia útil e se a cotação
// for recente (< 18 h): em fim de semana/feriado a API repete um valor velho -> usa o fechamento.
async function liveRates(): Promise<Rates | null> {
  const wd = weekdayLocal();
  if (wd === 0 || wd === 6) return null;
  const j = await getJson("https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL");
  const u = Number(j?.USDBRL?.ask), e = Number(j?.EURBRL?.ask);
  const ts = Number(j?.USDBRL?.timestamp) * 1000;
  if (!(u > 0) || !(e > 0) || !(ts > 0) || Date.now() - ts > 18 * 3600 * 1000) return null;
  return { usd: u, eur: e, date: ymdLocal(new Date(ts)), source: "AwesomeAPI (comercial ao vivo)" };
}

async function loadRates(): Promise<Rates | null> {
  const today = ymdLocal();
  if (ratesCache && ratesCache.key === today && Date.now() - ratesCache.at < RATES_MS) return ratesCache.v;
  let v: Rates | null = await liveRates();
  if (v) {
    ratesCache = { at: Date.now(), key: today, v };
    return v;
  }
  // Fim de semana, feriado ou AwesomeAPI fora do ar: último fechamento PTAX válido (Banco Central).
  const [usd, eur] = await Promise.all([ptaxClose("USD", today), ptaxClose("EUR", today)]);
  if (usd && eur) v = { usd: usd.v, eur: eur.v, date: usd.date, source: "PTAX/BCB" };
  else {
    // Reserva: BCE (Frankfurter) do dia útil anterior. A API devolve o último dia com cotação <= data pedida.
    const y = shiftDays(today, -1);
    const [fu, fe] = await Promise.all([
      getJson(`https://api.frankfurter.dev/v1/${y}?from=USD&to=BRL`),
      getJson(`https://api.frankfurter.dev/v1/${y}?from=EUR&to=BRL`),
    ]);
    const u = fu?.rates?.BRL, e = fe?.rates?.BRL;
    if (typeof u === "number" && typeof e === "number") v = { usd: u, eur: e, date: String(fu.date), source: "BCE" };
  }
  if (v) ratesCache = { at: Date.now(), key: today, v };
  return v ?? ratesCache?.v ?? null;
}

// METAR -> código WMO aproximado (mesma escala do Open-Meteo, usada para escolher o ícone).
function codeFromMetar(m: any): number | null {
  const wx = String(m?.wxString || "").toUpperCase();
  if (/TS/.test(wx)) return 95;
  if (/SH/.test(wx)) return 80;
  if (/RA|DZ/.test(wx)) return 61;
  if (/FG|BR|HZ/.test(wx)) return 45;
  const covers: string[] = Array.isArray(m?.clouds) ? m.clouds.map((c: any) => String(c?.cover || "")) : [];
  const cover = String(m?.cover || covers[covers.length - 1] || "").toUpperCase();
  if (/OVC|BKN/.test(cover) || covers.some((c) => /OVC|BKN/.test(c))) return 3;
  if (/SCT/.test(cover)) return 2;
  if (/FEW/.test(cover)) return 1;
  if (/CLR|SKC|CAVOK|NSC|NCD/.test(cover) || /CAVOK/.test(String(m?.rawOb || ""))) return 0;
  return null;
}

async function loadWeather(): Promise<Weather | null> {
  if (weatherCache && Date.now() - weatherCache.at < WEATHER_MS) return weatherCache.v;
  const [metar, om] = await Promise.all([
    getJson("https://aviationweather.gov/api/data/metar?ids=SBMO&format=json&hours=3"),
    getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
        "&current=temperature_2m,weather_code,is_day&timezone=America%2FMaceio",
    ),
  ]);
  const cur = om?.current;
  const obs0 = Array.isArray(metar) && metar.length ? metar[0] : null;
  // Ícone: código WMO do Open-Meteo; se ele falhar, deriva do METAR (tempo presente + nuvens).
  let code: number | null = typeof cur?.weather_code === "number" ? cur.weather_code : null;
  if (code === null && obs0) code = codeFromMetar(obs0);
  if (code === null && weatherCache?.v.code != null) code = weatherCache.v.code;
  const hourLocal = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
  const isDayFallback = hourLocal >= 5 && hourLocal < 18; // Maceió: sol ~5h-17h30 o ano todo
  const isDay = cur?.is_day === 0 ? false : cur?.is_day === 1 ? true : isDayFallback;
  let v: Weather | null = null;
  const obs = Array.isArray(metar)
    ? metar
        .filter((m: any) => m && typeof m.temp === "number" && typeof m.obsTime === "number")
        .sort((a: any, b: any) => b.obsTime - a.obsTime)[0]
    : null;
  // Medição real se tiver até 2 h; senão, modelo.
  if (obs && Date.now() / 1000 - obs.obsTime <= 2 * 3600) {
    v = { temp: obs.temp, code, isDay, source: "METAR SBMO", at: new Date(obs.obsTime * 1000).toISOString() };
  } else if (typeof cur?.temperature_2m === "number") {
    v = { temp: cur.temperature_2m, code, isDay, source: "Open-Meteo", at: String(cur.time || "") };
  }
  if (v) weatherCache = { at: Date.now(), v };
  return v ?? weatherCache?.v ?? null;
}

export const Route = createFileRoute("/api/public/infobar")({
  server: {
    handlers: {
      GET: async () => {
        const [weather, rates] = await Promise.all([
          loadWeather().catch(() => weatherCache?.v ?? null),
          loadRates().catch(() => ratesCache?.v ?? null),
        ]);
        // serverTime (ms UTC) é medido no fim, logo antes de responder: as TVs usam para acertar
        // o relógio (o Fire TV pode estar em UTC ou com hora errada). Fuso fixo de Maceió: UTC-3.
        const now = Date.now();
        return Response.json(
          { weather, rates, serverTime: now, utcOffsetMin: -180, updatedAt: new Date(now).toISOString() },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
