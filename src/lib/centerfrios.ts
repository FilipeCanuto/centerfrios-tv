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
};

export type ResolvedItem = {
  media_id: string;
  url: string;
  type: string;
  duration: number;
  title: string;
};

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
