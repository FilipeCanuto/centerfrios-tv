export const BRAND = {
  blue: "#0B4D9C",
  yellow: "#FFC700",
  white: "#FFFFFF",
  black: "#000000",
  slogan: "CENTERFRIOS — Crescendo com você",
};

export const LOGO_URL = "/logo.png";

// Janela de entrega de avisos/destaques: as TVs consultam a cada 25-30 s (economia de nuvem),
// então o painel mantém aviso/destaque disponível por +35 s além do tempo de tela. A TV exibe
// só o tempo de tela, contado de quando recebeu. Mesmo valor em public/player-engine.js.
export const DELIVERY_GRACE_MS = 35000;

export type MediaRow = {
  id: string;
  title: string;
  url: string;
  storage_path: string | null;
  type: string;
  duration: number;
  file_size: number | null;
  resolution: string | null;
  qr_url: string | null;
  created_at: string;
};

export type PlaylistItem = {
  media_id: string;
  order: number;
  custom_duration?: number | null;
  // Agenda opcional (sem agenda = toca sempre). days: 0=domingo..6=sábado.
  days?: number[] | null;
  start?: string | null; // "HH:MM"
  end?: string | null; // "HH:MM" (janela pode cruzar a meia-noite)
  from?: string | null; // "AAAA-MM-DD"
  until?: string | null; // "AAAA-MM-DD"
};

export function hasSchedule(it: PlaylistItem): boolean {
  return !!((it.days && it.days.length) || it.start || it.end || it.from || it.until);
}

export type PlaylistRow = {
  id: string;
  name: string;
  items: PlaylistItem[];
  created_at: string;
};

export type TvCommand = {
  action: "reload" | "mute" | "unmute" | "sync" | "purge";
  nonce: string;
};

export type TvRow = {
  id: string;
  name: string;
  pairing_code: string;
  is_paired: boolean;
  playlist_id: string | null;
  is_live_active: boolean;
  live_stream_url: string | null;
  last_ping: string | null;
  created_at: string;
  orientation: string;
  layout_mode: string;
  muted: boolean;
  ticker_text: string | null;
  qr_url: string | null;
  screen_resolution: string | null;
  memory_usage: string | null;
  command: TvCommand | null;
  event_mode: boolean;
  volume: number;
  ticker_position: string;
  qr_position: string;
  media_fit: string;
  sponsors_enabled: boolean;
  countdown_label: string | null;
  countdown_ends_at: string | null;
  welcome_message: string | null;
  welcome_until: string | null;
  show_presence_qr: boolean;
  presence_qr_position: string;
  show_weather: boolean;
  show_currency: boolean;
  presence_logo_size: number | null;
  show_logo: boolean;
  logo_size: number;
  show_news_ticker: boolean;
  news_queries: string | null;
  news_exclude: string | null;
  news_interval_min: number;
  // Endomarketing (migration 20261008150000); ausentes enquanto a migration não for aplicada
  is_endomarketing_active?: boolean;
  endomarketing_state?: EndoState | null;
};

/** Estado do modo Endomarketing gravado em tvs.endomarketing_state (o painel escreve, a TV obedece).
 *  `nonce` muda a cada comando pontual (trocar vídeo / voltar ao início): a TV aplica só uma vez.
 *  playing/volume/isMuted/loop/fullscreen são "estado contínuo": a TV sempre converge para eles. */
export type EndoState = {
  videoId: string;
  title: string;
  playing: boolean;
  currentTime: number; // posição desejada ao aplicar um nonce novo (0 = voltar ao início)
  volume: number; // 0-100
  isMuted: boolean;
  loop: boolean;
  fullscreen: boolean; // true = cobre rodapé/cantos; false = mantém a barra institucional
  momentTitle?: string;
  nonce: string;
};

export type EndoMoment = {
  id: string;
  title: string;
  description: string | null;
  youtube_url: string;
  suggested_volume: number;
  loop: boolean;
  order_index: number;
  created_at: string;
};

export type EndoQueueItem = {
  id: string;
  youtube_url: string;
  video_id: string;
  title: string | null;
  order_index: number;
  created_at: string;
};

export type EventCheckin = {
  id: string;
  full_name: string;
  phone: string;
  company: string;
  created_at: string;
};

export type EventPhoto = {
  id: string;
  image_url: string;
  storage_path: string | null;
  status: string;
  featured: boolean;
  featured_until?: string | null;
  created_at: string;
};

export type EventSponsor = {
  id: string;
  name: string;
  image_url: string;
  storage_path: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
};

export type TvAlert = {
  id: string;
  message: string;
  expires_at: string;
  created_at: string;
};

export type ResolvedItem = {
  media_id: string;
  url: string;
  type: string;
  duration: number;
  title: string;
  qr_url?: string | null;
};

export type AlertTemplate = {
  id: string;
  message: string;
  duration_seconds: number;
  created_at: string;
};

export const TV_SELECT_COLUMNS =
  "id,name,is_paired,playlist_id,is_live_active,last_ping,created_at,orientation,layout_mode,muted,ticker_text,qr_url,command,event_mode,volume,ticker_position,qr_position,media_fit,sponsors_enabled,countdown_label,countdown_ends_at,welcome_message,welcome_until,show_presence_qr,presence_qr_position,presence_logo_size,show_weather,show_currency";

// Colunas do rodapé de notícias / logo (migration 20260918150000). Enquanto a migration
// não foi aplicada no banco, a consulta com elas falha: use TV_SELECT_COLUMNS_LEGACY.
export const TV_NEWS_COLUMNS =
  "show_logo,logo_size,show_news_ticker,news_queries,news_exclude,news_interval_min";
export const TV_SELECT_COLUMNS_LEGACY = TV_SELECT_COLUMNS;
export const TV_SELECT_COLUMNS_FULL = TV_SELECT_COLUMNS + "," + TV_NEWS_COLUMNS;
// Colunas do Endomarketing (migration 20261008150000): mesmo esquema de reserva.
export const TV_ENDO_COLUMNS = "is_endomarketing_active,endomarketing_state";
export const TV_SELECT_COLUMNS_ENDO = TV_SELECT_COLUMNS_FULL + "," + TV_ENDO_COLUMNS;

export type NewsTickerItem = { text: string; source: string; promo?: boolean };


export function makeNonce(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (min === 0) return sec + " seg";
  if (sec === 0) return min + " min";
  return min + " min e " + sec + " seg";
}


export function generatePairingCode(): string {
  var code = "";
  for (var i = 0; i < 6; i++) {
    code += String(Math.floor(Math.random() * 10));
  }
  return code;
}

export function parsePlaylistItems(items: unknown): PlaylistItem[] {
  if (!Array.isArray(items)) return [];
  var out: PlaylistItem[] = [];
  for (var i = 0; i < items.length; i++) {
    var raw = items[i] as Record<string, unknown>;
    if (raw && typeof raw.media_id === "string") {
      out.push({
        media_id: raw.media_id,
        order: typeof raw.order === "number" ? raw.order : i,
        custom_duration:
          typeof raw.custom_duration === "number" ? raw.custom_duration : null,
        ...(Array.isArray(raw.days) && raw.days.length
          ? { days: (raw.days as unknown[]).filter((d) => typeof d === "number") as number[] }
          : {}),
        ...(typeof raw.start === "string" && raw.start ? { start: raw.start } : {}),
        ...(typeof raw.end === "string" && raw.end ? { end: raw.end } : {}),
        ...(typeof raw.from === "string" && raw.from ? { from: raw.from } : {}),
        ...(typeof raw.until === "string" && raw.until ? { until: raw.until } : {}),
      });
    }
  }
  out.sort(function (a, b) {
    return a.order - b.order;
  });
  return out;
}

export function isOnline(lastPing: string | null): boolean {
  if (!lastPing) return false;
  // TVs mandam sinal a cada 60 s: 150 s tolera 1 sinal perdido sem acusar "offline" à toa
  return Date.now() - new Date(lastPing).getTime() < 150000;
}

const YOUTUBE_ID_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function extractYoutubeId(url: string): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw; // ID puro (igual ao ytId do player-engine.js)
  const m = raw.match(YOUTUBE_ID_RE);
  return m ? m[1] : null;
}

export function youtubeThumbnail(id: string): string {
  return "https://img.youtube.com/vi/" + id + "/hqdefault.jpg";
}

export function youtubeWatchUrl(id: string): string {
  return "https://www.youtube.com/watch?v=" + id;
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

const STORAGE_KEYS = {
  tvId: "cf_tv_id",
  tvCode: "cf_tv_code",
  playlist: "cf_playlist_cache",
  deviceUuid: "centerfrios_device_uuid",
};

function readCookie(name: string): string | null {
  try {
    var parts = String(document.cookie || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+/, "");
      if (p.indexOf(name + "=") === 0) return decodeURIComponent(p.slice(name.length + 1));
    }
  } catch (e) {
    /* cookies indisponíveis */
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  try {
    document.cookie =
      name + "=" + encodeURIComponent(value) + ";path=/;max-age=" + 60 * 60 * 24 * 3650 + ";SameSite=Lax";
  } catch (e) {
    /* cookies indisponíveis */
  }
}

export function getDeviceUuid(): string {
  var existing: string | null = null;
  try {
    existing = window.localStorage.getItem(STORAGE_KEYS.deviceUuid);
  } catch (e) {
    existing = null;
  }
  if (!existing || existing.length < 8) existing = readCookie(STORAGE_KEYS.deviceUuid);

  if (existing && existing.length >= 8) {
    // reescreve nos dois lugares (kiosk pode limpar um deles)
    try {
      window.localStorage.setItem(STORAGE_KEYS.deviceUuid, existing);
    } catch (e) {
      /* storage indisponível */
    }
    writeCookie(STORAGE_KEYS.deviceUuid, existing);
    return existing;
  }

  var hex = "0123456789abcdef";
  var s = "";
  for (var i = 0; i < 32; i++) s += hex.charAt(Math.floor(Math.random() * 16));
  var uuid = "dev-" + s + "-" + String(Date.now());
  try {
    window.localStorage.setItem(STORAGE_KEYS.deviceUuid, uuid);
  } catch (e) {
    /* storage indisponível */
  }
  writeCookie(STORAGE_KEYS.deviceUuid, uuid);
  return uuid;
}


export const TV_STORAGE = STORAGE_KEYS;

export function readCache<T>(key: string): T | null {
  try {
    var raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (e) {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage cheio ou indisponível na TV */
  }
}
