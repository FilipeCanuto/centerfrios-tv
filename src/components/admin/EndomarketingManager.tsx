// Aba "Endomarketing" (MKT & RH): conduz dinâmicas nas TVs com vídeos do YouTube controlados ao vivo.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  extractYoutubeId,
  type EndoMoment,
  type EndoQueueItem,
  type EndoState,
  type TvRow,
} from "@/lib/centerfrios";
import { endEndo, fetchYoutubeTitle, patchState, pushState, startState } from "@/lib/endomarketing";
import { EndoTargets } from "@/components/admin/endo/EndoTargets";
import { EndoConsole } from "@/components/admin/endo/EndoConsole";
import { EndoMoments } from "@/components/admin/endo/EndoMoments";
import { EndoQueue } from "@/components/admin/endo/EndoQueue";
import { toast } from "sonner";

export function EndomarketingManager() {
  const [tvs, setTvs] = useState<TvRow[]>([]);
  const [targets, setTargets] = useState<Record<string, boolean>>({});
  const [st, setSt] = useState<EndoState | null>(null);
  const [volume, setVolume] = useState(80);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<EndoQueueItem[]>([]);
  const stRef = useRef<EndoState | null>(null);
  const initialized = useRef(false);
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  stRef.current = st;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("tvs")
      .select("*")
      .eq("is_paired", true)
      .order("created_at", { ascending: true });
    const list = (data || []) as unknown as TvRow[];
    setTvs(list);
    // 1ª carga: retoma uma atividade em andamento (ex.: painel reaberto no meio da dinâmica)
    if (!initialized.current) {
      initialized.current = true;
      const active = list.filter((t) => t.is_endomarketing_active);
      if (active.length) {
        const sel: Record<string, boolean> = {};
        active.forEach((t) => (sel[t.id] = true));
        setTargets(sel);
        const s = active.find((t) => t.endomarketing_state)?.endomarketing_state || null;
        if (s) {
          setSt(s);
          setVolume(typeof s.volume === "number" ? s.volume : 80);
        }
      }
    }
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("endo-tvs")
      .on("postgres_changes", { event: "*", schema: "public", table: "tvs" }, () => load())
      .subscribe();
    const t = setInterval(load, 15000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
      if (volTimer.current) clearTimeout(volTimer.current);
    };
  }, [load]);

  const ids = () => tvs.filter((t) => targets[t.id]).map((t) => t.id);

  async function send(next: EndoState, okMsg?: string) {
    const target = ids();
    if (!target.length) {
      toast.error("Selecione ao menos uma TV");
      return false;
    }
    setSt(next);
    setVolume(next.volume);
    setBusy(true);
    const err = await pushState(target, next);
    setBusy(false);
    if (err) {
      toast.error("Não foi possível enviar o comando: " + err);
      return false;
    }
    if (okMsg) toast.success(okMsg);
    return true;
  }

  function playMoment(m: EndoMoment) {
    const id = extractYoutubeId(m.youtube_url);
    if (!id) return toast.error("Link do YouTube inválido neste momento");
    fetchYoutubeTitle(id).then((title) =>
      send(
        startState(stRef.current, {
          videoId: id,
          title,
          volume: m.suggested_volume,
          loop: m.loop,
          momentTitle: m.title,
        }),
        '"' + m.title + '" disparado nas TVs selecionadas',
      ),
    );
  }

  function playQueueItem(it: EndoQueueItem) {
    send(
      startState(stRef.current, {
        videoId: it.video_id,
        title: it.title || "Vídeo " + it.video_id,
        loop: stRef.current?.loop,
      }),
      "Reproduzindo nas TVs selecionadas",
    );
  }

  const currentIdx = st ? queue.findIndex((q) => q.video_id === st.videoId) : -1;
  const nextItem = queue.length ? queue[(currentIdx + 1) % queue.length] : null;

  function onVolume(v: number) {
    setVolume(v); // slider responde na hora; envia para as TVs 300 ms depois de parar de arrastar
    if (volTimer.current) clearTimeout(volTimer.current);
    volTimer.current = setTimeout(() => {
      const cur = stRef.current;
      if (cur) send(patchState(cur, { volume: v }));
    }, 300);
  }

  async function onEnd() {
    const active = tvs.filter((t) => t.is_endomarketing_active).map((t) => t.id);
    const all = Array.from(new Set([...ids(), ...active]));
    if (!all.length) {
      setSt(null);
      return;
    }
    setBusy(true);
    const err = await endEndo(all);
    setBusy(false);
    if (err) return toast.error("Não foi possível encerrar: " + err);
    setSt(null);
    toast.success("Atividade encerrada — as TVs voltam à programação normal");
  }

  const cur = st;
  return (
    <div className="grid gap-5">
      <EndoConsole
        state={cur}
        volume={volume}
        busy={busy}
        hasNext={!!nextItem}
        // Play com nonce novo e currentTime -1: retoma do ponto (ou recomeça um vídeo que já terminou)
        onPlay={() => cur && send(patchState(cur, { playing: true, currentTime: -1 }, true))}
        onPause={() => cur && send(patchState(cur, { playing: false }))}
        onRestart={() => cur && send(patchState(cur, { currentTime: 0, playing: true }, true))}
        onNext={() => nextItem && playQueueItem(nextItem)}
        onLoop={() => cur && send(patchState(cur, { loop: !cur.loop }))}
        onFullscreen={() => cur && send(patchState(cur, { fullscreen: !cur.fullscreen }))}
        onVolume={onVolume}
        onMute={() => cur && send(patchState(cur, { isMuted: !cur.isMuted }))}
        onEnd={onEnd}
      />
      <EndoTargets tvs={tvs} targets={targets} setTargets={setTargets} />
      <EndoMoments onPlay={playMoment} disabled={busy} />
      <EndoQueue
        currentVideoId={cur?.videoId || null}
        onPlay={playQueueItem}
        onItems={setQueue}
        disabled={busy}
      />
    </div>
  );
}
