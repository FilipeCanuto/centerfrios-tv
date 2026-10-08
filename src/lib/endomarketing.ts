// Endomarketing (MKT & RH): helpers do painel para comandar as TVs ao vivo.
// O painel grava tvs.is_endomarketing_active + tvs.endomarketing_state; as TVs obedecem
// (player React via Realtime na hora; Fire TV entra em até 20 s e depois responde em até 2 s).
import { supabase } from "@/integrations/supabase/client";
import { extractYoutubeId, makeNonce, type EndoState } from "@/lib/centerfrios";
import type { Json } from "@/integrations/supabase/types";

export const DEFAULT_ENDO_VOLUME = 80;

/** Monta o estado para começar um vídeo (sempre com nonce novo). */
export function startState(
  base: EndoState | null,
  v: { videoId: string; title: string; volume?: number; loop?: boolean; momentTitle?: string },
): EndoState {
  return {
    videoId: v.videoId,
    title: v.title,
    playing: true,
    currentTime: 0,
    volume: typeof v.volume === "number" ? v.volume : (base?.volume ?? DEFAULT_ENDO_VOLUME),
    isMuted: false,
    loop: typeof v.loop === "boolean" ? v.loop : false,
    fullscreen: base?.fullscreen ?? false,
    momentTitle: v.momentTitle || undefined,
    nonce: makeNonce(),
  };
}

/** Aplica um patch ao estado. newNonce = comando pontual (troca/volta ao início/retomar vídeo encerrado). */
export function patchState(st: EndoState, patch: Partial<EndoState>, newNonce = false): EndoState {
  const next: EndoState = { ...st, ...patch };
  next.nonce = newNonce ? makeNonce() : st.nonce;
  return next;
}

/** Grava o estado nas TVs escolhidas e liga o modo. */
export async function pushState(tvIds: string[], st: EndoState): Promise<string | null> {
  if (!tvIds.length) return "Selecione ao menos uma TV";
  const { error } = await supabase
    .from("tvs")
    .update({ is_endomarketing_active: true, endomarketing_state: st as unknown as Json })
    .in("id", tvIds);
  return error ? error.message : null;
}

/** Desliga o modo nas TVs (voltam para a playlist normal). */
export async function endEndo(tvIds: string[]): Promise<string | null> {
  if (!tvIds.length) return null;
  const { error } = await supabase
    .from("tvs")
    .update({ is_endomarketing_active: false, endomarketing_state: null })
    .in("id", tvIds);
  return error ? error.message : null;
}

/** Título do vídeo pelo oEmbed (YouTube; reserva noembed). Sem rede: "Vídeo <id>". */
export async function fetchYoutubeTitle(urlOrId: string): Promise<string> {
  const id = extractYoutubeId(urlOrId);
  if (!id) return "";
  const watch = "https://www.youtube.com/watch?v=" + id;
  const tries = [
    "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(watch),
    "https://noembed.com/embed?url=" + encodeURIComponent(watch),
  ];
  for (const u of tries) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const j = await r.json();
      if (j && typeof j.title === "string" && j.title) return j.title;
    } catch {
      /* tenta a próxima */
    }
  }
  return "Vídeo " + id;
}

export function youtubeThumb(id: string): string {
  return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
}
