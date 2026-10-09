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
const RATES_MS = 5 * 60 * 1000; // boletim oficial do horário: confere de novo a cada 5 min

async function getJson(url: string, ms = 7000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    // User-Agent explícito: algumas APIs recusam pedidos sem ele vindos de servidores (Cloudflare Workers).
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "CenterfriosTV/1.0 (+https://centerfrios-tv.lovable.app)",
      },
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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
function shiftDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const toBcb = (ymd: string) => ymd.slice(5, 7) + "-" + ymd.slice(8, 10) + "-" + ymd.slice(0, 4); // MM-DD-AAAA

// ---------- Cotações: 2 atualizações por dia útil, com boletins oficiais PTAX (Banco Central) ----------
// - antes das 10h (ou fim de semana/feriado): último FECHAMENTO PTAX de um dia útil anterior;
// - a partir das 10h: boletim de ABERTURA do dia (o BC publica ~10h05, logo após a abertura da bolsa);
// - a partir das 14h: FECHAMENTO PTAX do dia (o BC publica ~13h10).
// Enquanto o boletim do horário ainda não saiu, continua o valor anterior. Todas as TVs mostram o mesmo
// número porque ele vem de um boletim oficial com horário fixo (não de "agora").
// Usa o endpoint de UM dia (CotacaoMoedaDia): desde out/2026 o BC bloqueia (403) a consulta por período
// com $select, e o boletim de fechamento passou a se chamar "Fechamento PTAX".
type Boletim = { v: number; tipo: string; hora: string };

async function ptaxDia(moeda: "USD" | "EUR", ymd: string): Promise<Boletim[] | null> {
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)" +
    `?@moeda='${moeda}'&@dataCotacao='${toBcb(ymd)}'&$format=json`;
  const j = await getJson(url, 8000);
  if (!j || !Array.isArray(j.value)) return null; // null = falha de rede/bloqueio (≠ lista vazia = sem boletim)
  return j.value
    .filter((r: any) => r && typeof r.cotacaoVenda === "number")
    .map((r: any) => ({
      v: r.cotacaoVenda,
      tipo: String(r.tipoBoletim || ""),
      hora: String(r.dataHoraCotacao || "").slice(11, 16),
    }));
}

const isFech = (b: Boletim) => /^fechamento/i.test(b.tipo);
const isAbert = (b: Boletim) => /^abertura/i.test(b.tipo);

// Hora local de Maceió em minutos desde 00:00.
function minutesLocal(d = new Date()): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .split(":");
  return (Number(p[0]) % 24) * 60 + Number(p[1]);
}

// Último fechamento PTAX de um dia anterior a hoje (volta até 10 dias: fins de semana/feriados).
async function lastClose(
  moeda: "USD" | "EUR",
  today: string,
): Promise<{ v: number; date: string } | null> {
  for (let i = 1; i <= 10; i++) {
    const day = shiftDays(today, -i);
    const list = await ptaxDia(moeda, day);
    if (list === null) return null; // BC fora do ar: não insiste
    const f = list.filter(isFech).pop();
    if (f) return { v: f.v, date: day };
  }
  return null;
}

async function ptaxSlot(
  moeda: "USD" | "EUR",
  today: string,
  mins: number,
): Promise<{ v: number; date: string; slot: string } | null> {
  if (mins >= 10 * 60) {
    const list = await ptaxDia(moeda, today);
    if (list === null) return null;
    const fech = list.filter(isFech).pop();
    if (mins >= 14 * 60 && fech) return { v: fech.v, date: today, slot: "fechamento" };
    const ab = list.filter(isAbert)[0];
    if (ab) return { v: ab.v, date: today, slot: "abertura" };
    // 10h-14h e o boletim de abertura ainda não saiu (ou feriado): último fechamento anterior
  }
  const c = await lastClose(moeda, today);
  return c ? { ...c, slot: "fechamento anterior" } : null;
}

// Reserva se o Banco Central estiver fora/bloqueando: AwesomeAPI (comercial) em dia útil.
async function awesomeRates(): Promise<Rates | null> {
  const j = await getJson("https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL");
  const u = Number(j?.USDBRL?.ask),
    e = Number(j?.EURBRL?.ask);
  if (!(u > 0) || !(e > 0)) return null;
  return { usd: u, eur: e, date: ymdLocal(), source: "AwesomeAPI (reserva)" };
}

let ratesDiag = "";
async function loadRates(): Promise<Rates | null> {
  const today = ymdLocal();
  const mins = minutesLocal();
  // a chave muda nos horários de troca: 10h e 14h já buscam o boletim novo na hora
  const slotKey = today + "|" + (mins >= 14 * 60 ? "14" : mins >= 10 * 60 ? "10" : "00");
  if (ratesCache && ratesCache.key === slotKey && Date.now() - ratesCache.at < RATES_MS)
    return ratesCache.v;
  let v: Rates | null = null;
  const [u, e] = await Promise.all([ptaxSlot("USD", today, mins), ptaxSlot("EUR", today, mins)]);
  if (u && e) {
    v = { usd: u.v, eur: e.v, date: u.date, source: "PTAX/BCB " + u.slot };
    ratesDiag = "ptax ok";
  } else {
    ratesDiag = "ptax falhou";
    v = await awesomeRates();
    if (!v) {
      // última reserva: BCE (Frankfurter) do dia útil anterior
      const y = shiftDays(today, -1);
      const [fu, fe] = await Promise.all([
        getJson(`https://api.frankfurter.dev/v1/${y}?from=USD&to=BRL`),
        getJson(`https://api.frankfurter.dev/v1/${y}?from=EUR&to=BRL`),
      ]);
      const a = fu?.rates?.BRL,
        b = fe?.rates?.BRL;
      if (typeof a === "number" && typeof b === "number")
        v = { usd: a, eur: b, date: String(fu.date), source: "BCE (reserva)" };
    }
  }
  // Valor oficial do mesmo horário: guarda 5 min. Reserva (PTAX falhou): tenta o BC de novo em 1 min.
  if (v)
    ratesCache = {
      at: Date.now() - (ratesDiag === "ptax ok" ? 0 : RATES_MS - 60000),
      key: slotKey,
      v,
    };
  return v ?? ratesCache?.v ?? null;
}

// METAR -> código WMO aproximado (mesma escala do Open-Meteo, usada para escolher o ícone).
function codeFromMetar(m: any): number | null {
  const wx = String(m?.wxString || "").toUpperCase();
  if (/TS/.test(wx)) return 95;
  if (/SH/.test(wx)) return 80;
  if (/RA|DZ/.test(wx)) return 61;
  if (/FG|BR|HZ/.test(wx)) return 45;
  const covers: string[] = Array.isArray(m?.clouds)
    ? m.clouds.map((c: any) => String(c?.cover || ""))
    : [];
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
  const hourLocal = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(
      new Date(),
    ),
  );
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
    v = {
      temp: obs.temp,
      code,
      isDay,
      source: "METAR SBMO",
      at: new Date(obs.obsTime * 1000).toISOString(),
    };
  } else if (typeof cur?.temperature_2m === "number") {
    v = { temp: cur.temperature_2m, code, isDay, source: "Open-Meteo", at: String(cur.time || "") };
  }
  if (v) weatherCache = { at: Date.now(), v };
  return v ?? weatherCache?.v ?? null;
}

export const Route = createFileRoute("/api/public/infobar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const debug = new URL(request.url).searchParams.get("debug");
        const [weather, rates] = await Promise.all([
          loadWeather().catch(() => weatherCache?.v ?? null),
          loadRates().catch(() => ratesCache?.v ?? null),
        ]);
        // serverTime (ms UTC) é medido no fim, logo antes de responder: as TVs usam para acertar
        // o relógio (o Fire TV pode estar em UTC ou com hora errada). Fuso fixo de Maceió: UTC-3.
        const now = Date.now();
        return Response.json(
          {
            weather,
            rates,
            serverTime: now,
            utcOffsetMin: -180,
            updatedAt: new Date(now).toISOString(),
            ...(debug ? { diag: { rates: ratesDiag } } : {}),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
