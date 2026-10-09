// Player do modo Endomarketing (player React "/"): mesmo comportamento do player-engine.js.
// Converge sempre para o estado (playing, volume, isMuted, loop) e aplica UMA vez por nonce
// a troca de vídeo / ida para currentTime (>= 0; negativo = só libera vídeo que terminou).
import { useEffect, useRef, useState } from "react";
import { BRAND, LOGO_URL, extractYoutubeId, type EndoState } from "@/lib/centerfrios";

type YTP = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (s: number, allow: boolean) => void;
  setVolume: (v: number) => void;
  mute: () => void;
  unMute: () => void;
  getPlayerState: () => number;
  destroy: () => void;
};
type YTNS = {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTP;
  PlayerState: { ENDED: number; PLAYING: number; BUFFERING: number; PAUSED: number };
};

let apiPromise: Promise<YTNS> | null = null;
function loadApi(): Promise<YTNS> {
  const w = window as unknown as { YT?: YTNS; onYouTubeIframeAPIReady?: () => void };
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve(w.YT as YTNS);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return apiPromise;
}

export function EndoPlayer({ state }: { state: EndoState }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTP | null>(null);
  const ytRef = useRef<YTNS | null>(null);
  const readyRef = useRef(false);
  const stateRef = useRef(state);
  const applied = useRef({ nonce: "", volume: -1, muted: null as boolean | null });
  const endedRef = useRef(false);
  const audio = useRef({ blocked: false, unmuteAt: 0, stuck: 0, wantKey: "" });
  const [ended, setEnded] = useState(false);
  const [title, setTitle] = useState<string>("");
  const videoId = extractYoutubeId(state.videoId) || state.videoId;
  stateRef.current = state;

  function markEnded(v: boolean) {
    endedRef.current = v;
    setEnded(v);
  }

  function onEnded() {
    const p = playerRef.current;
    if (stateRef.current.loop && p) {
      try {
        p.seekTo(0, true);
        p.playVideo();
      } catch {
        /* ignore */
      }
      return;
    }
    markEnded(true); // sem loop: tela institucional até o próximo comando
  }

  // converge o player para o estado (roda a cada mudança e a cada 2 s)
  function sync(fromNonce: boolean) {
    const p = playerRef.current;
    const YT = ytRef.current;
    const st = stateRef.current;
    if (!p || !YT || !readyRef.current) return;
    const vol = Math.max(0, Math.min(100, Math.round(Number(st.volume)))) || 0;
    if (applied.current.volume !== vol) {
      applied.current.volume = vol;
      try {
        p.setVolume(vol);
      } catch {
        /* ignore */
      }
    }
    // Som: o player nasce MUDO (autoplay sem som é sempre permitido). Só liga o som com o vídeo já
    // tocando. Se o navegador (Silk/Smart TV) barrar o som e pausar, volta para o mudo e continua
    // tocando; tenta o som de novo no próximo comando do painel ou ao apertar o controle remoto.
    const wantSound = !st.isMuted && vol > 0;
    const wantKey = (st.isMuted ? "m" : "s") + "|" + applied.current.nonce;
    if (wantKey !== audio.current.wantKey) {
      audio.current.wantKey = wantKey;
      audio.current.blocked = false;
    }
    let s = -9;
    try {
      s = p.getPlayerState();
    } catch {
      /* ignore */
    }
    const now = Date.now();
    try {
      if (st.playing && !endedRef.current) {
        if (s === YT.PlayerState.PLAYING) {
          audio.current.stuck = 0;
          if (wantSound && !audio.current.blocked && applied.current.muted !== false) {
            p.unMute();
            p.setVolume(vol);
            applied.current.muted = false;
            audio.current.unmuteAt = now;
          } else if (!wantSound && applied.current.muted !== true) {
            p.mute();
            applied.current.muted = true;
          }
        } else if (s !== YT.PlayerState.BUFFERING) {
          if (applied.current.muted === false && now - audio.current.unmuteAt < 8000)
            audio.current.blocked = true;
          audio.current.stuck++;
          if (audio.current.blocked || audio.current.stuck >= 2) {
            p.mute();
            applied.current.muted = true;
          }
          p.playVideo();
        }
      } else if (!st.playing) {
        audio.current.stuck = 0;
        if (s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING) p.pauseVideo();
      }
    } catch {
      /* ignore */
    }
    if (s === YT.PlayerState.ENDED && !endedRef.current && !fromNonce) onEnded();
  }

  // cria/recria o player quando o vídeo muda
  useEffect(() => {
    let cancelled = false;
    readyRef.current = false;
    applied.current.volume = -1;
    applied.current.muted = null;
    loadApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      ytRef.current = YT;
      hostRef.current.innerHTML = "";
      const holder = document.createElement("div");
      hostRef.current.appendChild(holder);
      playerRef.current = new YT.Player(holder, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: stateRef.current.playing ? 1 : 0,
          mute: 1, // nasce mudo: autoplay sem som é sempre permitido
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
          widget_referrer: window.location.href,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            try {
              playerRef.current?.mute();
            } catch {
              /* ignore */
            }
            applied.current.muted = true;
            audio.current.stuck = 0;
            sync(true);
          },
          onStateChange: (e: { data: number }) => {
            if (e.data === YT.PlayerState.ENDED) onEnded();
            else if (e.data === YT.PlayerState.PLAYING) {
              markEnded(false);
              sync(false); // liga o som já
            } else if (
              e.data === YT.PlayerState.PAUSED &&
              stateRef.current.playing &&
              !endedRef.current
            ) {
              setTimeout(() => sync(false), 300); // pausou sozinho (som barrado): recupera
            }
          },
          onError: () => markEnded(true),
        },
      });
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // comandos pontuais (nonce) + estado contínuo
  useEffect(() => {
    const nonce = String(state.nonce || "");
    const isNew = nonce !== applied.current.nonce;
    if (isNew) {
      applied.current.nonce = nonce;
      markEnded(false);
      setTitle(state.momentTitle || "");
      const p = playerRef.current;
      const ct = Number(state.currentTime);
      if (p && readyRef.current) {
        try {
          if (ct >= 0) p.seekTo(ct, true);
          if (state.playing) p.playVideo();
        } catch {
          /* ignore */
        }
      }
    }
    sync(isNew);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.nonce, state.playing, state.volume, state.isMuted, state.loop, videoId]);

  // leitura periódica (o evento ENDED às vezes não chega em Smart TVs)
  useEffect(() => {
    const t = setInterval(() => sync(false), 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // qualquer tecla do controle remoto = gesto do usuário: libera o som bloqueado
  useEffect(() => {
    function onKey() {
      const p = playerRef.current;
      const st = stateRef.current;
      audio.current.blocked = false;
      if (!p || !readyRef.current || st.isMuted) return;
      try {
        p.unMute();
        p.setVolume(Math.max(0, Math.min(100, Math.round(Number(st.volume)))) || 0);
        if (st.playing) p.playVideo();
        applied.current.muted = false;
        audio.current.unmuteAt = Date.now();
      } catch {
        /* ignore */
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // título do momento por 8 s
  useEffect(() => {
    if (!title) return;
    const t = setTimeout(() => setTitle(""), 8000);
    return () => clearTimeout(t);
  }, [title, state.nonce]);

  return (
    <div style={{ position: "absolute", inset: 0, backgroundColor: "#000000", overflow: "hidden" }}>
      <div
        ref={hostRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        className="cf-endo-host"
      />
      {title ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "8%",
            textAlign: "center",
            color: BRAND.yellow,
            fontSize: "46px",
            fontWeight: 800,
            padding: "18px 6%",
            textShadow: "0 4px 18px rgba(0,0,0,0.9)",
            background:
              "linear-gradient(90deg,rgba(10,57,129,0),rgba(10,57,129,0.85) 20%,rgba(10,57,129,0.85) 80%,rgba(10,57,129,0))",
          }}
        >
          {title}
        </div>
      ) : null}
      {ended ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "#0A3981",
            textAlign: "center",
            color: BRAND.yellow,
          }}
        >
          <img
            src={LOGO_URL}
            alt="CENTERFRIOS"
            style={{ marginTop: "18%", width: "40%", maxWidth: "520px" }}
          />
          <div style={{ fontSize: "30px", fontWeight: 800, marginTop: "30px" }}>{BRAND.slogan}</div>
        </div>
      ) : null}
    </div>
  );
}
