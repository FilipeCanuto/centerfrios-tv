import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  BRAND,
  LOGO_URL,
  TV_STORAGE,
  generatePairingCode,
  parsePlaylistItems,
  readCache,
  writeCache,
  type MediaRow,
  type ResolvedItem,
  type TvRow,
} from "@/lib/centerfrios";

type Status = "boot" | "pairing" | "playing" | "empty";

export function TvPlayer() {
  const [status, setStatus] = useState<Status>("boot");
  const [code, setCode] = useState<string>("");
  const [tv, setTv] = useState<TvRow | null>(null);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [index, setIndex] = useState(0);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const tvIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- registro / pareamento ----------
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      let storedCode = window.localStorage.getItem(TV_STORAGE.tvCode);
      let storedId = window.localStorage.getItem(TV_STORAGE.tvId);

      if (!storedCode) {
        storedCode = generatePairingCode();
        window.localStorage.setItem(TV_STORAGE.tvCode, storedCode);
      }
      setCode(storedCode);

      try {
        const { data, error } = await supabase.rpc("register_tv", { _code: storedCode });
        if (error) throw error;
        if (typeof data === "string") {
          storedId = data;
          window.localStorage.setItem(TV_STORAGE.tvId, data);
        }
      } catch (e) {
        console.warn("[CENTERFRIOS] registro offline", e);
        setOffline(true);
      }

      if (cancelled) return;
      tvIdRef.current = storedId;

      const cached = readCache<ResolvedItem[]>(TV_STORAGE.playlist);
      if (cached && cached.length > 0) {
        setItems(cached);
        setStatus("playing");
      }

      await refreshTv(storedId);
    }

    boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshTv(id: string | null) {
    if (!id) {
      setStatus((s) => (s === "playing" ? s : "pairing"));
      return;
    }
    const { data, error } = await supabase.from("tvs").select("id,name,is_paired,playlist_id,is_live_active,last_ping,created_at").eq("id", id).maybeSingle();
    if (error || !data) {
      setOffline(true);
      return;
    }
    setOffline(false);
    const row = data as unknown as TvRow;
    setTv(row);
    if (!row.is_paired) {
      setStatus("pairing");
      return;
    }
    await loadPlaylist(row.playlist_id);
  }

  async function loadPlaylist(playlistId: string | null) {
    if (!playlistId) {
      const cached = readCache<ResolvedItem[]>(TV_STORAGE.playlist);
      setItems(cached || []);
      setStatus(cached && cached.length ? "playing" : "empty");
      return;
    }

    const { data: pl } = await supabase
      .from("playlists")
      .select("id,name,items,created_at")
      .eq("id", playlistId)
      .maybeSingle();
    const { data: mediaRows } = await supabase.from("media").select("id,title,url,type,duration,created_at");

    if (!pl || !mediaRows) {
      const cached = readCache<ResolvedItem[]>(TV_STORAGE.playlist);
      if (cached && cached.length) {
        setItems(cached);
        setStatus("playing");
      }
      return;
    }

    const byId: Record<string, MediaRow> = {};
    (mediaRows as unknown as MediaRow[]).forEach((m) => {
      byId[m.id] = m;
    });

    const resolved: ResolvedItem[] = [];
    parsePlaylistItems((pl as { items: unknown }).items).forEach((it) => {
      const m = byId[it.media_id];
      if (!m) return;
      resolved.push({
        media_id: m.id,
        url: m.url,
        type: m.type,
        title: m.title,
        duration: it.custom_duration || m.duration || 10,
      });
    });

    setItems(resolved);
    writeCache(TV_STORAGE.playlist, resolved);
    setIndex(0);
    setStatus(resolved.length ? "playing" : "empty");
  }

  // ---------- realtime ----------
  useEffect(() => {
    if (!tv) return;
    const channel = supabase
      .channel("tv-" + tv.id)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tvs", filter: "id=eq." + tv.id },
        (payload) => {
          const row = payload.new as unknown as TvRow;
          setTv(row);
          if (!row.is_paired) {
            setStatus("pairing");
          } else if (!tv || row.playlist_id !== tv.playlist_id) {
            loadPlaylist(row.playlist_id);
          }
          if (!row.is_live_active) setLiveFrame(null);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "playlists" },
        () => {
          if (tv.playlist_id) loadPlaylist(tv.playlist_id);
        },
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_frames" }, (p) => {
        const row = p.new as { frame_data?: string };
        if (row && row.frame_data) setLiveFrame(row.frame_data);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv ? tv.id : null, tv ? tv.playlist_id : null]);

  // ---------- ping + revalidação periódica ----------
  useEffect(() => {
    const interval = setInterval(() => {
      const id = tvIdRef.current;
      if (!id) return;
      supabase.rpc("tv_ping", { _id: id }).then(
        () => setOffline(false),
        () => setOffline(true),
      );
      refreshTv(id);
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- avanço de imagens ----------
  const current = items.length ? items[index % items.length] : null;
  const next = items.length > 1 ? items[(index + 1) % items.length] : null;
  const liveOn = !!(tv && tv.is_live_active);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (liveOn || !current || current.type === "video") return;
    const ms = Math.max(3, current.duration || 10) * 1000;
    timerRef.current = setTimeout(() => setIndex((i) => i + 1), ms);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [index, current, liveOn]);

  function advance() {
    setIndex((i) => i + 1);
  }

  // ---------- render ----------
  if (status === "boot") {
    return (
      <Stage>
        <img src={LOGO_URL} alt="CENTERFRIOS" style={{ width: "40%", maxWidth: "520px" }} />
      </Stage>
    );
  }

  if (liveOn) {
    return (
      <Stage>
        {tv && tv.live_stream_url ? (
          <video
            src={tv.live_stream_url}
            autoPlay
            muted
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : liveFrame ? (
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
          AO VIVO
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
      </Stage>
    );
  }

  return (
    <Stage>
      {current.type === "video" ? (
        <video
          key={current.media_id + "-" + index}
          src={current.url}
          autoPlay
          muted
          playsInline
          preload="auto"
          onEnded={advance}
          onError={advance}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <img
          key={current.media_id + "-" + index}
          src={current.url}
          alt={current.title}
          onError={advance}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      )}

      {/* Pre-buffering do próximo item (invisível) */}
      {next ? (
        next.type === "video" ? (
          <video
            src={next.url}
            preload="auto"
            muted
            playsInline
            style={{ position: "absolute", width: "1px", height: "1px", opacity: 0.01 }}
          />
        ) : (
          <img
            src={next.url}
            alt=""
            style={{ position: "absolute", width: "1px", height: "1px", opacity: 0.01 }}
          />
        )
      ) : null}
    </Stage>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
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
      }}
    >
      {children}
    </div>
  );
}
