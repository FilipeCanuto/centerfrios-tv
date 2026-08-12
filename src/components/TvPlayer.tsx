import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import {
  BRAND,
  LOGO_URL,
  TV_SELECT_COLUMNS,
  TV_STORAGE,
  getDeviceUuid,
  parsePlaylistItems,
  type EventPhoto,
  type MediaRow,
  type ResolvedItem,
  type TvRow,
} from "@/lib/centerfrios";
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
const STALL_MS = 15000;
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

  const tvIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tvRef = useRef<TvRow | null>(null);

  tvRef.current = tv;

  const advance = useCallback(() => setIndex((i) => i + 1), []);

  // ---------- registro / pareamento (código sempre vem do servidor) ----------
  useEffect(() => {
    let cancelled = false;

    async function registerWithBackoff(deviceUuid: string) {
      const delays = [3000, 5000, 10000];
      let attempt = 0;
      // tenta indefinidamente com backoff, sem nunca trocar o device_uuid
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

      // não mostra o código antes de saber se a TV já está pareada
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
      const [{ data: pl }, { data: mediaRows }] = await Promise.all([
        supabase.from("playlists").select("id,name,items,created_at").eq("id", playlistId).maybeSingle(),
        supabase.from("media").select("id,title,url,type,duration,qr_url,created_at"),
      ]);

      if (pl && mediaRows) {
        const byId: Record<string, MediaRow> = {};
        (mediaRows as unknown as MediaRow[]).forEach((m) => {
          byId[m.id] = m;
        });
        parsePlaylistItems((pl as { items: unknown }).items).forEach((it) => {
          const m = byId[it.media_id];
          if (!m) return;
          resolved.push({
            media_id: m.id,
            url: m.url,
            type: m.type,
            title: m.title,
            qr_url: m.qr_url,
            duration: it.custom_duration || m.duration || 10,
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
      // já pareada (ou com playlist vinculada) → inicia direto, sem tela de código
      if (!row.is_paired && !row.playlist_id && !row.event_mode) {
        setStatus("pairing");
        return;
      }
      await loadPlaylist(row.playlist_id, row.event_mode);
    },
    [loadPlaylist],
  );

  // ---------- comandos remotos ----------
  const runCommand = useCallback((cmd: TvRow["command"]) => {
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
    }
  }, [refreshTv]);

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

  // ---------- destaque imediato ----------
  useEffect(() => {
    if (!tv?.event_mode) {
      setFeatured(null);
      return;
    }
    let stop = false;
    async function poll() {
      const { data } = await supabase
        .from("event_photos")
        .select("id,image_url,status,featured,created_at")
        .eq("status", "approved")
        .eq("featured", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (stop) return;
      const row = ((data || []) as unknown as EventPhoto[])[0] || null;
      setFeatured(row && row.image_url ? row : null);
    }
    poll();
    const t = setInterval(poll, 10000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [tv?.event_mode]);

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

    // fallback híbrido: se o WebSocket for bloqueado, detecta pareamento em 4s
    const guard = setInterval(async () => {
      const id = tvIdRef.current;
      if (!id) return;
      const { data } = await supabase
        .from("tvs")
        .select("id,is_paired,playlist_id,event_mode,layout_mode,orientation,command")
        .eq("id", id)
        .maybeSingle();
      if (!data) return;
      const row = data as unknown as Pick<
        TvRow,
        "is_paired" | "playlist_id" | "event_mode" | "layout_mode" | "orientation" | "command"
      >;
      const prev = tvRef.current;
      if (
        !prev ||
        prev.is_paired !== row.is_paired ||
        prev.playlist_id !== row.playlist_id ||
        prev.event_mode !== row.event_mode ||
        prev.layout_mode !== row.layout_mode ||
        prev.orientation !== row.orientation
      ) {
        refreshTv(id);
      }
      // fallback do botão "Forçar sincronização" quando o WebSocket está bloqueado
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
      const now = new Date();
      if (now.getHours() === 3 && now.getMinutes() === 0) window.location.reload();
    }, 60000);
    return () => clearInterval(check);
  }, []);

  const current = items.length ? items[index % items.length] : null;
  const currentQrUrl = (current && current.qr_url) || tv?.qr_url || null;

  // ---------- QR code dinâmico (mídia atual tem prioridade sobre a TV) ----------
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
      setBack((prevFront) => prevFront);
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

  // garbage collection da camada anterior
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

  // ---------- temporizador de imagens / travamento de vídeo ----------
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (stallRef.current) clearTimeout(stallRef.current);
    if (liveOn || !current || featured || alertMsg) return;

    if (current.type === "video") {
      stallRef.current = setTimeout(advance, STALL_MS);
    } else {
      timerRef.current = setTimeout(advance, Math.max(3, current.duration || 10) * 1000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (stallRef.current) clearTimeout(stallRef.current);
    };
  }, [index, current, liveOn, featured, alertMsg, advance]);

  const stageStyle = useMemo(
    () => (portrait ? ({ writingMode: "horizontal-tb" } as const) : ({} as const)),
    [portrait],
  );

  // ---------- render ----------
  if (status === "boot" || status === "connecting") {
    return (
      <Stage>
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
      <Stage>
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

  if (liveOn) {
    return (
      <Stage style={stageStyle}>
        {liveFrame ? (
          <img
            src={liveFrame}
            alt="Transmissão ao vivo"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
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
        {alertMsg ? <AlertOverlay message={alertMsg} /> : null}
      </Stage>
    );
  }

  if (featured) {
    return (
      <Stage>
        <img
          src={featured.image_url}
          alt="Destaque do mural"
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "18px",
            textAlign: "center",
            backgroundColor: "rgba(10,57,129,0.85)",
            color: "#FFC700",
            fontSize: "34px",
            fontWeight: 800,
          }}
        >
          MURAL DO EVENTO CENTERFRIOS
        </div>
        {alertMsg ? <AlertOverlay message={alertMsg} /> : null}
      </Stage>
    );
  }

  if (status === "empty" || !current) {
    return (
      <Stage>
        <div style={{ textAlign: "center", color: "#FFFFFF" }}>
          <img src={LOGO_URL} alt="CENTERFRIOS" style={{ width: "34%", maxWidth: "460px" }} />
          <p style={{ fontSize: "28px", marginTop: "32px", opacity: 0.8 }}>
            Nenhum conteúdo vinculado a esta TV
          </p>
          <p style={{ fontSize: "20px", marginTop: "12px", color: BRAND.yellow }}>{BRAND.slogan}</p>
        </div>
        {alertMsg ? <AlertOverlay message={alertMsg} /> : null}
      </Stage>
    );
  }

  const mainZone: React.CSSProperties = multizone
    ? { position: "absolute", top: 0, left: 0, right: 0, bottom: "90px" }
    : { position: "absolute", inset: 0 };

  return (
    <Stage style={stageStyle}>
      <div style={mainZone}>
        {back ? <MediaLayer layer={back} muted opacity={1} /> : null}
        {front ? (
          <MediaLayer
            key={front.key}
            layer={front}
            muted={tv?.muted !== false}
            opacity={1}
            fade
            videoRef={videoRef}
            onEnded={advance}
            onError={advance}
          />
        ) : null}
      </div>

      {multizone ? (
        <>
          <div
            style={{
              position: "absolute",
              top: "18px",
              right: "18px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              backgroundColor: "rgba(10,57,129,0.85)",
              borderRadius: "14px",
              padding: "12px 16px",
            }}
          >
            <img src={LOGO_URL} alt="CENTERFRIOS" style={{ height: "48px" }} />
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR code" style={{ height: "80px", width: "80px" }} />
            ) : null}
          </div>

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
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
        </>
      ) : null}

      {!multizone && current.qr_url && qrDataUrl ? (
        <div
          style={{
            position: "absolute",
            right: "24px",
            bottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            backgroundColor: "rgba(10,57,129,0.9)",
            borderRadius: "16px",
            padding: "12px 16px",
          }}
        >
          <img src={qrDataUrl} alt="QR code" style={{ height: "104px", width: "104px" }} />
          <span style={{ color: "#FFC700", fontSize: "24px", fontWeight: 800, maxWidth: "260px" }}>
            Aponte a câmera e saiba mais
          </span>
        </div>
      ) : null}

      {alertMsg ? <AlertOverlay message={alertMsg} /> : null}
    </Stage>
  );
}

function MediaLayer({
  layer,
  muted,
  opacity,
  fade,
  videoRef,
  onEnded,
  onError,
}: {
  layer: Layer;
  muted: boolean;
  opacity: number;
  fade?: boolean;
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>;
  onEnded?: () => void;
  onError?: () => void;
}) {
  const base: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    opacity,
    animation: fade ? "cf-fade-in 0.7s ease-out" : undefined,
  };

  if (layer.item.type === "video") {
    return (
      <video
        ref={videoRef}
        src={layer.src}
        autoPlay
        muted={muted}
        playsInline
        preload="metadata"
        onEnded={onEnded}
        onError={onError}
        style={base}
      />
    );
  }
  return <img src={layer.src} alt={layer.item.title} onError={onError} style={base} />;
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

function Stage({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#000000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
