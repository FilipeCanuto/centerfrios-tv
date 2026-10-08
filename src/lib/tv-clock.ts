// Hora certa da TV, independente do relógio/fuso do aparelho (Fire TV pode estar em UTC ou errado).
// offset = hora do servidor (/api/public/infobar -> serverTime) - hora local. Mesma lógica do
// player-engine.js (nowMs/cfNow). Fuso fixo da Centerfrios: America/Maceio = UTC-3, sem horário de verão.

const CF_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;
let offset = 0;
let synced = false;

/** Agora em UTC "de verdade" (ms). Use no lugar de Date.now() ao comparar com horários do servidor. */
export function tvNow(): number {
  return Date.now() + offset;
}

export function isTvClockSynced(): boolean {
  return synced;
}

/** Registra o horário do servidor medido numa requisição que começou em t0 e terminou em t1 (ms locais). */
export function syncTvClock(serverTime: unknown, t0: number, t1: number): void {
  if (typeof serverTime !== "number" || !(serverTime > 0) || t1 - t0 > 10000) return;
  offset = serverTime + (t1 - t0) / 2 - t1;
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
export async function fetchInfobarAndSync(): Promise<any> {
  const t0 = Date.now();
  try {
    const res = await fetch("/api/public/infobar?t=" + t0, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    syncTvClock(data?.serverTime, t0, Date.now());
    return data;
  } catch {
    return null;
  }
}
