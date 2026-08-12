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
