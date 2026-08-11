export const BRAND = {
  blue: "#0B4D9C",
  yellow: "#FFC700",
  white: "#FFFFFF",
  black: "#000000",
  slogan: "CENTERFRIOS — Crescendo com você",
};

export const LOGO_URL = "/logo.png";

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
};

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
};

export type EventPhoto = {
  id: string;
  image_url: string;
  storage_path: string | null;
  status: string;
  featured: boolean;
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
  "id,name,is_paired,playlist_id,is_live_active,last_ping,created_at,orientation,layout_mode,muted,ticker_text,qr_url,command,event_mode";

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
  return Date.now() - new Date(lastPing).getTime() < 90000;
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
};

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
