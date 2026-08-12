import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import {
  BRAND,
  LOGO_URL,
  TV_SELECT_COLUMNS,
  TV_STORAGE,
  getDeviceUuid,
  type EventPhoto,
  type EventSponsor,
  type ResolvedItem,
  type TvRow,
} from "@/lib/centerfrios";
import { attachAudioChain, resumeAudio } from "@/lib/audio-chain";
import {
  loadManifest,
  precacheMedia,
  pruneCache,
  purgeAll,
  resolveMediaUrl,
  saveManifest,
} from "@/lib/player-cache";

type Status = "boot" | "connecting" | "pairing" | "playing" | "empty";
type Layer = { key: string; item: ResolvedItem; src: string; revoke: boolean };

const MANIFEST_KEY = "playlist";
const HEARTBEAT_MS = 8000;
const METADATA_GUARD_MS = 20000;
const FADE_MS = 700;

export function TvPlayer() {
  const [status, setStatus] = useState<Status>("boot");
  const [code, setCode] = useState("");
  const [tv, setTv] = useState<TvRow | null>(null);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [index, setIndex] = useState(0);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [front, setFront] = useState<Layer | null>(null);
  const [back, setBack] = useState<Layer | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [featured, setFeatured] = useState<EventPhoto | null>(null);
  const [sponsors, setSponsors] = useState<EventSponsor[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const tvIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tvRef = useRef<TvRow | null>(null);

  tvRef.current = tv;

  const advance = useCallback(() => setIndex((i) => i + 1), []);

  // relógio compartilhado (cronômetro / destaque / vinheta)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------- registro / pareamento (código sempre vem do servidor) ----------
  useEffect(() => {
    let cancelled = false;

    async function registerWithBackoff(deviceUuid: string) {
      const delays = [3000, 5000, 10000];
      let attempt = 0;
      for (;;) {
        if (cancelled) return null;
        try {
          const { data, error } = await supabase.rpc("register_tv_device", {
            p_device_uuid: deviceUuid,
          });
          if (error) throw error;
          const res = data as { id?: string; pairing_code?: string } | null;
          if (res && res.id && res.pairing_code) {
            setOffline(false);
            return res as { id: string; pairing_code: string };
          }
          throw new Error("resposta inválida");
        } catch {
          if (cancelled) return null;
          setOffline(true);
          const wait = delays[Math.min(attempt, delays.length - 1)];
          attempt += 1;
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }

    async function boot() {
      setStatus("connecting");
      const deviceUuid = getDeviceUuid();

      const cached = await loadManifest(MANIFEST_KEY);
      if (cached && cached.length > 0 && !cancelled) setItems(cached);

      const res = await registerWithBackoff(deviceUuid);
      if (cancelled || !res) return;

      window.localStorage.setItem(TV_STORAGE.tvId, res.id);
      window.localStorage.setItem(TV_STORAGE.tvCode, res.pairing_code);
      tvIdRef.current = res.id;
      setCode(res.pairing_code);

      await refreshTv(res.id);
    }

    boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPlaylist = useCallback(async (playlistId: string | null, eventMode: boolean) => {
    const resolved: ResolvedItem[] = [];

    if (playlistId) {
      const { data: rows, error } = await supabase.rpc("get_tv_playlist_items", {
        p_playlist_id: playlistId,
      });

      if (!error && rows) {
        (
          rows as unknown as Array<{
            media_id: string;
            title: string;
            url: string;
            type: string;
            duration: number | null;
            qr_url: string | null;
          }>
        ).forEach((r) => {
          if (!r.url) return;
          resolved.push({
            media_id: r.media_id,
            url: r.url,
            type: r.type,
            title: r.title,
            qr_url: r.qr_url,
            duration: r.duration || 10,
          });
        });
      }
    }

    if (eventMode) {
      const { data: photos } = await supabase
        .from("event_photos")
        .select("id,image_url,status,featured,created_at")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(40);
      ((photos || []) as unknown as EventPhoto[]).forEach((p) => {
        if (!p.image_url) return;
        resolved.push({
          media_id: "event-" + p.id,
          url: p.image_url,
          type: "image",
          title: "Mural do evento",
          duration: 8,
        });
      });
    }

    if (resolved.length === 0) {
      const cached = await loadManifest(MANIFEST_KEY);
      if (cached && cached.length) {
        setItems(cached);
        setStatus("playing");
        return;
      }
      setItems([]);
      setStatus("empty");
      return;
    }

    setItems(resolved);
    setIndex(0);
    setStatus("playing");
    saveManifest(MANIFEST_KEY, resolved);
    precacheMedia(resolved).then(() => pruneCache(resolved));
  }, []);

  const refreshTv = useCallback(
    async (id: string | null) => {
      if (!id) {
        setStatus((s) => (s === "playing" ? s : "pairing"));
        return;
      }
      const { data, error } = await supabase
        .from("tvs")
        .select(TV_SELECT_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        setOffline(true);
        return;
      }
      setOffline(false);
      const row = data as unknown as TvRow;
      setTv(row);
      if (!row.is_paired && !row.playlist_id && !row.event_mode) {
        setStatus("pairing");
        return;
      }
      await loadPlaylist(row.playlist_id, row.event_mode);
    },
    [loadPlaylist],
  );

  // ---------- comandos remotos ----------
  const runCommand = useCallback(
    (cmd: TvRow["command"]) => {
      if (!cmd || !cmd.nonce) return;
      const seen = window.localStorage.getItem("cf_last_nonce");
      if (seen === cmd.nonce) return;
      window.localStorage.setItem("cf_last_nonce", cmd.nonce);
      if (cmd.action === "reload") {
        window.location.reload();
        return;
      }
      if (cmd.action === "purge") {
        purgeAll().then(() => {
          setTimeout(() => window.location.reload(), 1000);
        });
        return;
      }
      if (cmd.action === "sync") {
        refreshTv(tvIdRef.current);
        return;
      }
      if (videoRef.current) {
        videoRef.current.muted = cmd.action === "mute";
        resumeAudio();
      }
    },
    [refreshTv],
  );

  // ---------- realtime ----------
  useEffect(() => {
    const id = tv?.id;
    if (!id) return;
    const channel = supabase
      .channel("tv-" + id)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tvs", filter: "id=eq." + id },
        (payload) => {
          const row = payload.new as unknown as TvRow;
          const prev = tvRef.current;
          setTv(row);
          if (!row.is_paired && !row.playlist_id && !row.event_mode) setStatus("pairing");
          else if (
            !prev ||
            row.playlist_id !== prev.playlist_id ||
            row.event_mode !== prev.event_mode ||
            row.is_paired !== prev.is_paired
          ) {
            loadPlaylist(row.playlist_id, row.event_mode);
          }
          if (!row.is_live_active) setLiveFrame(null);
          runCommand(row.command);
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "playlists" }, () => {
        const t = tvRef.current;
        if (t) loadPlaylist(t.playlist_id, t.event_mode);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "media" }, () => {
        const t = tvRef.current;
        if (t && t.playlist_id) loadPlaylist(t.playlist_id, t.event_mode);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "event_photos" }, () => {
        const t = tvRef.current;
        if (t && t.event_mode) loadPlaylist(t.playlist_id, true);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_frames" }, (p) => {
        const row = p.new as { frame_data?: string };
        if (row && row.frame_data) setLiveFrame(row.frame_data);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tv_alerts" }, (p) => {
        const row = p.new as { message?: string; expires_at?: string };
        if (!row || !row.message) return;
        setAlertMsg(row.message);
        const ms = row.expires_at
          ? Math.max(5000, new Date(row.expires_at).getTime() - Date.now())
          : 20000;
        setTimeout(() => setAlertMsg(null), Math.min(ms, 120000));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tv?.id, loadPlaylist, runCommand]);

  // ---------- destaque (spotlight) ----------
  useEffect(() => {
    if (!tv?.event_mode) {
      setFeatured(null);
      return;
    }
    let stop = false;
    async function poll() {
      const { data } = await supabase
        .from("event_photos")
        .select("id,image_url,status,featured,featured_until,created_at")
        .eq("status", "approved")
        .eq("featured", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (stop) return;
      const row = ((data || []) as unknown as EventPhoto[])[0] || null;
      setFeatured(row && row.image_url ? row : null);
    }
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [tv?.event_mode]);

  // ---------- patrocinadores ----------
  useEffect(() => {
    if (!tv?.sponsors_enabled) {
      setSponsors([]);
      return;
    }
    let stop = false;
    async function load() {
      const { data } = await supabase
        .from("event_sponsors")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (!stop) setSponsors((data || []) as unknown as EventSponsor[]);
    }
    load();
    const t = setInterval(load, 60000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [tv?.sponsors_enabled]);

  // ---------- heartbeat + revalidação ----------
  useEffect(() => {
    const beat = () => {
      const id = tvIdRef.current;
      if (!id) return;
      const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
      const memory = perf.memory
        ? Math.round(perf.memory.usedJSHeapSize / (1024 * 1024)) + " MB"
        : undefined;

      supabase
        .rpc("tv_heartbeat", {
          _id: id,
          _resolution: window.screen.width + "x" + window.screen.height,
          _memory: memory,
        })
        .then(
          () => setOffline(false),
          () => setOffline(true),
        );
    };
    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    const revalidate = setInterval(() => refreshTv(tvIdRef.current), 60000);

    const guard = setInterval(async () => {
      const id = tvIdRef.current;
      if (!id) return;
      const { data } = await supabase
        .from("tvs")
        .select(TV_SELECT_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (!data) return;
      const row = data as unknown as TvRow;
      const prev = tvRef.current;
      const structural =
        !prev ||
        prev.is_paired !== row.is_paired ||
        prev.playlist_id !== row.playlist_id ||
        prev.event_mode !== row.event_mode;
      setTv(row);
      if (structural) refreshTv(id);
      runCommand(row.command);
    }, 4000);

    return () => {
      clearInterval(interval);
      clearInterval(revalidate);
      clearInterval(guard);
    };
  }, [refreshTv, runCommand]);

  // ---------- reload preventivo diário às 03:00 ----------
  useEffect(() => {
    const check = setInterval(() => {
      const d = new Date();
      if (d.getHours() === 3 && d.getMinutes() === 0) window.location.reload();
    }, 60000);
    return () => clearInterval(check);
  }, []);

  const current = items.length ? items[index % items.length] : null;
  const currentQrUrl = (current && current.qr_url) || tv?.qr_url || null;

  // ---------- QR code dinâmico ----------
  useEffect(() => {
    const url = currentQrUrl;
    if (!url) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(url, { margin: 1, width: 240 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [currentQrUrl]);

  const liveOn = !!(tv && tv.is_live_active);
  const multizone = tv?.layout_mode === "multizone";
  const portrait = tv?.orientation === "portrait";
  const volume = typeof tv?.volume === "number" ? tv.volume : 100;
  const objectFit: "cover" | "contain" = tv?.media_fit === "cover" ? "cover" : "contain";
  const tickerPosition = tv?.ticker_position || "bottom";
  const qrPosition = tv?.qr_position || "top-right";

  const spotlightOn = !!(
    featured &&
    featured.image_url &&
    (!featured.featured_until || new Date(featured.featured_until).getTime() > now)
  );
  const welcomeOn = !!(
    tv?.welcome_message &&
    tv.welcome_until &&
    new Date(tv.welcome_until).getTime() > now
  );
  const countdownMs =
    tv?.countdown_ends_at ? new Date(tv.countdown_ends_at).getTime() - now : -1;
  const countdownOn = countdownMs > 0;

  // ---------- crossfade + resolução de fonte (cache) ----------
  useEffect(() => {
    if (!current || liveOn) return;
    let cancelled = false;
    const key = current.media_id + "-" + index;

    resolveMediaUrl(current.url).then(({ src, revoke }) => {
      if (cancelled) {
        if (revoke) URL.revokeObjectURL(src);
        return;
      }
      setFront((prev) => {
        setBack(prev);
        return { key, item: current, src, revoke };
      });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.media_id, index, liveOn]);

  useEffect(() => {
    if (!back) return;
    const t = setTimeout(() => {
      setBack((b) => {
        if (b && b.revoke) URL.revokeObjectURL(b.src);
        return null;
      });
    }, FADE_MS + 100);
    return () => clearTimeout(t);
  }, [back?.key]);

  // ---------- temporizador: imagens por duração, vídeos até o fim ----------
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (stallRef.current) clearTimeout(stallRef.current);
    if (liveOn || !current || spotlightOn || welcomeOn || alertMsg) return;

    if (current.type === "video") {
      // apenas rede de segurança até os metadados chegarem; o avanço real é o onEnded
      stallRef.current = setTimeout(advance, METADATA_GUARD_MS);
    } else {
      timerRef.current = setTimeout(advance, Math.max(3, current.duration || 10) * 1000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (stallRef.current) clearTimeout(stallRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current, liveOn, spotlightOn, welcomeOn, alertMsg, advance]);

  // quando os metadados do vídeo chegam, a rede de segurança passa a valer a duração real
  const handleVideoMetadata = useCallback((seconds: number) => {
    if (stallRef.current) clearTimeout(stallRef.current);
    if (!isFinite(seconds) || seconds <= 0) return;
    stallRef.current = setTimeout(() => setIndex((i) => i + 1), seconds * 1000 + 8000);
  }, []);

  const overlays = (
    <>
      {countdownOn ? <Countdown label={tv?.countdown_label || null} ms={countdownMs} /> : null}
      {sponsors.length > 0 ? (
        <SponsorRail sponsors={sponsors} position={tickerPosition === "top" ? "bottom" : "top"} />
      ) : null}
      {alertMsg ? <AlertOverlay message={alertMsg} /> : null}
    </>
  );

  // ---------- render ----------
  if (status === "boot" || status === "connecting") {
    return (
      <Stage portrait={false}>
        <div style={{ textAlign: "center", color: "#FFFFFF", padding: "32px" }}>
          <img src={LOGO_URL} alt="CENTERFRIOS" style={{ width: "38%", maxWidth: "520px" }} />
          <p style={{ fontSize: "30px", marginTop: "48px", color: BRAND.yellow }}>
            {offline
              ? "Aguardando resposta da nuvem… Revalidando em 3s"
              : "Conectando ao servidor e gerando código…"}
          </p>
          <p style={{ fontSize: "20px", marginTop: "40px", color: "#FFFFFF", opacity: 0.7 }}>
            {BRAND.slogan}
          </p>
        </div>
      </Stage>
    );
  }

  if (status === "pairing") {
    return (
      <Stage portrait={portrait}>
        <div style={{ textAlign: "center", color: "#FFFFFF", padding: "32px" }}>
          <img src={LOGO_URL} alt="CENTERFRIOS" style={{ width: "38%", maxWidth: "520px" }} />
          <p style={{ fontSize: "28px", marginTop: "40px", opacity: 0.85 }}>
            Código de pareamento desta TV
          </p>
          <div
            style={{
              fontSize: "140px",
              lineHeight: 1.05,
              fontWeight: 800,
              letterSpacing: "16px",
              color: BRAND.yellow,
              marginTop: "8px",
            }}
          >
            {code}
          </div>
          <p style={{ fontSize: "30px", marginTop: "24px" }}>
            Acesse o painel no celular para ativar esta TV
          </p>
          <p style={{ fontSize: "20px", marginTop: "56px", color: BRAND.yellow, opacity: 0.9 }}>
            {BRAND.slogan}
          </p>
          {offline ? (
            <p style={{ fontSize: "16px", marginTop: "16px", opacity: 0.6 }}>
              Sem conexão com o servidor — tentando novamente…
            </p>
          ) : null}
        </div>
      </Stage>
    );
  }

  if (welcomeOn) {
    return (
      <Stage portrait={portrait}>
        <div style={{ textAlign: "center", padding: "6%" }}>
          <img src={LOGO_URL} alt="CENTERFRIOS" style={{ height: "110px" }} />
          <p
            style={{
              marginTop: "40px",
              color: BRAND.yellow,
              fontSize: "40px",
              fontWeight: 800,
              letterSpacing: "6px",
            }}
          >
            BOAS-VINDAS
          </p>
          <p
            style={{
              marginTop: "18px",
              color: "#FFFFFF",
              fontSize: "78px",
              lineHeight: 1.15,
              fontWeight: 800,
            }}
          >
            {tv?.welcome_message}
          </p>
        </div>
        {overlays}
      </Stage>
    );
  }

  if (liveOn) {
    return (
      <Stage portrait={portrait}>
        {liveFrame ? (
          <img
            src={liveFrame}
            alt="Transmissão ao vivo"
            style={{ width: "100%", height: "100%", objectFit }}
          />
        ) : (
          <div style={{ textAlign: "center", color: "#FFFFFF" }}>
            <img src={LOGO_URL} alt="CENTERFRIOS" style={{ width: "320px", maxWidth: "60%" }} />
            <p style={{ fontSize: "32px", marginTop: "24px", color: BRAND.yellow, fontWeight: 800 }}>
              CONECTANDO À TRANSMISSÃO AO VIVO…
            </p>
          </div>
        )}
        <Badge>AO VIVO</Badge>
        {overlays}
      </Stage>
    );
  }

  if (spotlightOn && featured) {
    return (
      <Stage portrait={portrait}>
        <div style={{ position: "absolute", inset: "24px", border: "10px solid " + BRAND.yellow, borderRadius: "22px", overflow: "hidden" }}>
          <img
            src={featured.image_url}
            alt="Destaque do mural"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "18px",
            textAlign: "center",
            backgroundColor: "rgba(10,57,129,0.9)",
            color: BRAND.yellow,
            fontSize: "34px",
            fontWeight: 800,
          }}
        >
          MURAL DO EVENTO CENTERFRIOS
        </div>
        {overlays}
      </Stage>
    );
  }

  if (status === "empty" || !current) {
    return (
      <Stage portrait={portrait}>
        <div style={{ textAlign: "center", color: "#FFFFFF" }}>
          <img src={LOGO_URL} alt="CENTERFRIOS" style={{ width: "34%", maxWidth: "460px" }} />
          <p style={{ fontSize: "28px", marginTop: "32px", opacity: 0.8 }}>
            {tv && tv.playlist_id
              ? "Playlist vinculada não possui mídias cadastradas"
              : "Nenhum conteúdo vinculado a esta TV"}
          </p>
          <p style={{ fontSize: "20px", marginTop: "12px", color: BRAND.yellow }}>{BRAND.slogan}</p>
        </div>
        {overlays}
      </Stage>
    );
  }

  const tickerVisible = multizone && tickerPosition !== "hidden";
  const mainZone: React.CSSProperties = tickerVisible
    ? {
        position: "absolute",
        left: 0,
        right: 0,
        top: tickerPosition === "top" ? "90px" : 0,
        bottom: tickerPosition === "top" ? 0 : "90px",
      }
    : { position: "absolute", inset: 0 };

  const corner = cornerStyle(qrPosition);

  return (
    <Stage portrait={portrait}>
      <div style={mainZone}>
        {back ? <MediaLayer layer={back} muted objectFit={objectFit} volume={0} /> : null}
        {front ? (
          <MediaLayer
            key={front.key}
            layer={front}
            muted={tv?.muted !== false}
            volume={volume}
            objectFit={objectFit}
            fade
            videoRef={videoRef}
            onEnded={advance}
            onError={advance}
            onMetadata={handleVideoMetadata}
          />
        ) : null}
      </div>

      {multizone ? (
        <>
          <div
            style={{
              position: "absolute",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              backgroundColor: "rgba(10,57,129,0.85)",
              borderRadius: "14px",
              padding: "12px 16px",
              ...corner,
            }}
          >
            <img src={LOGO_URL} alt="CENTERFRIOS" style={{ height: "48px" }} />
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR code" style={{ height: "80px", width: "80px" }} />
            ) : null}
          </div>

          {tickerVisible ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: tickerPosition === "top" ? 0 : undefined,
                bottom: tickerPosition === "top" ? undefined : 0,
                height: "90px",
                backgroundColor: "#0A3981",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                overflow: "hidden",
              }}
            >
              <div className="cf-ticker" style={{ fontSize: "40px", fontWeight: 800 }}>
                {tv?.ticker_text || BRAND.slogan}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {!multizone && current.qr_url && qrDataUrl ? (
        <div
          style={{
            position: "absolute",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            backgroundColor: "rgba(10,57,129,0.9)",
            borderRadius: "16px",
            padding: "12px 16px",
            ...corner,
          }}
        >
          <img src={qrDataUrl} alt="QR code" style={{ height: "104px", width: "104px" }} />
          <span style={{ color: "#FFC700", fontSize: "24px", fontWeight: 800, maxWidth: "260px" }}>
            Aponte a câmera e saiba mais
          </span>
        </div>
      ) : null}

      {overlays}
    </Stage>
  );
}

function cornerStyle(position: string): React.CSSProperties {
  if (position === "top-left") return { top: "18px", left: "18px" };
  if (position === "bottom-left") return { bottom: "18px", left: "18px" };
  if (position === "bottom-right") return { bottom: "18px", right: "18px" };
  return { top: "18px", right: "18px" };
}

function MediaLayer({
  layer,
  muted,
  volume,
  objectFit,
  fade,
  videoRef,
  onEnded,
  onError,
  onWaiting,
  onResume,
}: {
  layer: Layer;
  muted: boolean;
  volume: number;
  objectFit: "cover" | "contain";
  fade?: boolean;
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>;
  onEnded?: () => void;
  onError?: () => void;
  onWaiting?: () => void;
  onResume?: () => void;
}) {
  const localRef = useRef<HTMLVideoElement | null>(null);

  // volume nativo (sem Web Audio) para preservar a aceleração de hardware
  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, volume / 100));
  }, [layer.src, volume]);

  const base: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit,
    transform: "translate3d(0, 0, 0)",
    backfaceVisibility: "hidden",
    willChange: "transform",
    animation: fade ? "cf-fade-in 0.7s ease-out" : undefined,
  };

  if (layer.item.type === "video") {
    return (
      <video
        ref={(el) => {
          localRef.current = el;
          if (videoRef) videoRef.current = el;
        }}
        src={layer.src}
        autoPlay
        muted={muted}
        playsInline
        preload="auto"
        onLoadedMetadata={(e) => {
          e.currentTarget.volume = Math.min(1, Math.max(0, volume / 100));
        }}
        onEnded={onEnded}
        onError={onError}
        onWaiting={onWaiting}
        onStalled={onWaiting}
        onPlaying={onResume}
        onCanPlay={onResume}
        style={base}
      />
    );
  }
  return <img src={layer.src} alt={layer.item.title} onError={onError} style={base} />;
}


function SponsorRail({
  sponsors,
  position,
}: {
  sponsors: EventSponsor[];
  position: "top" | "bottom";
}) {
  const loop = sponsors.concat(sponsors);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: position === "top" ? 0 : undefined,
        bottom: position === "bottom" ? 0 : undefined,
        height: "84px",
        backgroundColor: "rgba(255,255,255,0.94)",
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <div className="cf-ticker" style={{ display: "flex", alignItems: "center", gap: "48px" }}>
        {loop.map((s, i) => (
          <img
            key={s.id + "-" + i}
            src={s.image_url}
            alt={s.name}
            style={{ height: "56px", objectFit: "contain" }}
          />
        ))}
      </div>
    </div>
  );
}

function Countdown({ label, ms }: { label: string | null; ms: number }) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "24px",
        transform: "translateX(-50%)",
        backgroundColor: "rgba(10,57,129,0.92)",
        borderRadius: "18px",
        padding: "14px 28px",
        textAlign: "center",
        color: "#FFFFFF",
      }}
    >
      <p style={{ fontSize: "22px", fontWeight: 700, opacity: 0.9 }}>
        {label || "Começa em"}
      </p>
      <p style={{ fontSize: "56px", fontWeight: 800, color: BRAND.yellow, lineHeight: 1.1 }}>
        {mm}:{ss}
      </p>
    </div>
  );
}

function AlertOverlay({ message }: { message: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(10,57,129,0.94)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6%",
        textAlign: "center",
      }}
    >
      <div>
        <img src={LOGO_URL} alt="CENTERFRIOS" style={{ height: "80px" }} />
        <p
          style={{
            marginTop: "36px",
            color: "#FFC700",
            fontSize: "72px",
            lineHeight: 1.15,
            fontWeight: 800,
          }}
        >
          {message}
        </p>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "24px",
        left: "24px",
        backgroundColor: "#D32F2F",
        color: "#FFFFFF",
        padding: "8px 18px",
        borderRadius: "6px",
        fontWeight: 800,
        fontSize: "22px",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Palco do player. Em modo retrato (9:16) todo o conteúdo é girado 90° no
 * sentido anti-horário, trocando largura/altura para ocupar a tela inteira.
 */
function Stage({ children, portrait }: { children: React.ReactNode; portrait: boolean }) {
  const gpu: React.CSSProperties = {
    transform: "translate3d(0, 0, 0)",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    willChange: "transform",
  } as React.CSSProperties;

  const inner: React.CSSProperties = portrait
    ? {
        position: "absolute",
        top: "50%",
        left: "50%",
        width: "100vh",
        height: "100vw",
        transform: "translate(-50%, -50%) rotate(-90deg) translate3d(0, 0, 0)",
        transformOrigin: "center center",
        backfaceVisibility: "hidden",
        willChange: "transform",
        backgroundColor: "#000000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }
    : {
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        ...gpu,
      };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#000000",
        overflow: "hidden",
        ...gpu,
      }}
    >
      <div style={inner}>{children}</div>
    </div>
  );
}

/** Spinner discreto exibido apenas enquanto o vídeo enche o buffer. */
function BufferSpinner() {
  return (
    <div
      style={{
        position: "absolute",
        right: "28px",
        bottom: "28px",
        width: "46px",
        height: "46px",
        borderRadius: "50%",
        border: "5px solid rgba(255,255,255,0.25)",
        borderTopColor: BRAND.yellow,
        animation: "cf-spin 0.9s linear infinite",
      }}
    />
  );
}

/** Pré-carrega a próxima mídia da playlist fora da tela. */
function Preloader({ item }: { item: ResolvedItem | null }) {
  if (!item) return null;
  if (item.type === "video") {
    return (
      <video
        key={item.media_id}
        src={item.url}
        preload="auto"
        muted
        playsInline
        style={{ display: "none" }}
      />
    );
  }
  return <img key={item.media_id} src={item.url} alt="" style={{ display: "none" }} />;
}

