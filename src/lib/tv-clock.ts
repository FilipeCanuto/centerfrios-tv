// Hora certa da TV, independente do relógio/fuso do aparelho (Fire TV pode estar em UTC ou errado).
// offset = hora do servidor (/api/public/infobar -> serverTime) - hora local. Mesma lógica do
// player-engine.js (nowMs/cfNow). Fuso fixo da Centerfrios: America/Maceio = UTC-3, sem horário de verão.

const CF_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;
let offset = 0;
let synced = false;
// Âncora monotônica (performance.now não muda quando o aparelho acerta/erra o próprio relógio).
let anchor: { server: number; mono: number } | null = null;
let lastRtt = 1e9;
const mono = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/** Agora em UTC "de verdade" (ms). Use no lugar de Date.now() ao comparar com horários do servidor. */
export function tvNow(): number {
  if (anchor) return anchor.server + (mono() - anchor.mono);
  return Date.now() + offset;
}

export function isTvClockSynced(): boolean {
  return synced;
}

/** Registra o horário do servidor medido numa requisição (m0/m1 = mono() no início/fim; t1 = Date.now() no fim). */
export function syncTvClock(serverTime: unknown, m0: number, m1: number, t1: number): void {
  if (typeof serverTime !== "number" || !(serverTime > 0)) return;
  const rtt = m1 - m0;
  if (!(rtt >= 0) || rtt > 30000) return;
  // medida bem pior que a atual só substitui se a atual tiver mais de 1 h
  if (anchor && rtt > lastRtt * 2 + 500 && mono() - anchor.mono < 3600000) return;
  const mid = serverTime + rtt / 2;
  anchor = { server: mid, mono: m1 };
  offset = mid - t1;
  lastRtt = rtt;
  synced = true;
}

/** Hora de Maceió (componentes já no fuso UTC-3). */
export function maceioNow(): { h: number; m: number; day: number; ymd: string; dayIndex: number } {
  const d = new Date(tvNow() + CF_UTC_OFFSET_MS);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return {
    h: d.getUTCHours(),
    m: d.getUTCMinutes(),
    day: d.getUTCDay(),
    ymd: d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()),
    dayIndex: Math.floor(d.getTime() / 86400000), // muda à meia-noite de Maceió
  };
}

/** "HH:MM" em Maceió. */
export function maceioHHMM(): string {
  const { h, m } = maceioNow();
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** Busca /api/public/infobar e acerta o relógio. Devolve o JSON (ou null). */
export async function fetchInfobarAndSync(): Promise<unknown> {
  const m0 = mono();
  try {
    const res = await fetch("/api/public/infobar?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { serverTime?: unknown } | null;
    syncTvClock(data?.serverTime, m0, mono(), Date.now());
    return data;
  } catch {
    return null;
  }
}
