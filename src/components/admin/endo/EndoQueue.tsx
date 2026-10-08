// Endomarketing — Fila de reprodução (compartilhada entre admins via tabela endomarketing_queue).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractYoutubeId, type EndoQueueItem } from "@/lib/centerfrios";
import { fetchYoutubeTitle, youtubeThumb } from "@/lib/endomarketing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ListVideo, Play, Plus, Trash2 } from "lucide-react";

export function EndoQueue({
  currentVideoId,
  onPlay,
  onItems,
  disabled,
}: {
  currentVideoId: string | null;
  onPlay: (item: EndoQueueItem) => void;
  onItems?: (items: EndoQueueItem[]) => void;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<EndoQueueItem[]>([]);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("endomarketing_queue")
      .select("*")
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return;
    const list = (data || []) as unknown as EndoQueueItem[];
    setItems(list);
    onItems?.(list);
  }, [onItems]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("endo-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "endomarketing_queue" }, () =>
        load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  async function add() {
    const id = extractYoutubeId(url);
    if (!id)
      return toast.error("Cole um link do YouTube (youtube.com/watch?v=... ou youtu.be/...)");
    setAdding(true);
    const title = await fetchYoutubeTitle(id);
    const max = items.reduce((m, it) => Math.max(m, it.order_index), 0);
    const { error } = await supabase
      .from("endomarketing_queue")
      .insert({ youtube_url: url.trim(), video_id: id, title, order_index: max + 1 });
    setAdding(false);
    if (error) return toast.error("Não foi possível adicionar à fila");
    setUrl("");
    load();
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    const tmp = next[index];
    next[index] = next[j];
    next[j] = tmp;
    setItems(next); // otimista
    onItems?.(next);
    // regrava a ordem 1..n (fila curta: poucas linhas)
    await Promise.all(
      next.map((it, i) =>
        supabase
          .from("endomarketing_queue")
          .update({ order_index: i + 1 })
          .eq("id", it.id),
      ),
    );
    load();
  }

  async function remove(it: EndoQueueItem) {
    const { error } = await supabase.from("endomarketing_queue").delete().eq("id", it.id);
    if (error) return toast.error("Não foi possível remover");
    load();
  }

  return (
    <section className="cf-card p-5">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-base font-extrabold">
          <ListVideo className="h-4 w-4" /> Fila de Reprodução
        </h3>
        <p className="text-xs text-muted-foreground">
          Cole links avulsos do YouTube. "Próximo da fila" segue esta ordem.
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="https://www.youtube.com/watch?v=...  ou  https://youtu.be/..."
        />
        <Button onClick={add} disabled={adding || !url.trim()} className="shrink-0 font-bold">
          <Plus className="mr-1 h-4 w-4" /> {adding ? "Buscando…" : "Adicionar"}
        </Button>
      </div>

      <ol className="mt-3 grid gap-2">
        {items.map((it, i) => {
          const playingNow = currentVideoId === it.video_id;
          return (
            <li
              key={it.id}
              className={
                "flex items-center gap-3 rounded-xl border p-2 " +
                (playingNow ? "border-primary bg-secondary/60" : "border-border bg-card")
              }
            >
              <img
                src={youtubeThumb(it.video_id)}
                alt=""
                className="h-12 w-20 shrink-0 rounded-md bg-black object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {it.title || "Vídeo " + it.video_id}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {i + 1}º na fila{playingNow ? " · tocando agora" : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label="Subir"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label="Descer"
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  className="h-8 rounded-lg font-bold"
                  disabled={disabled}
                  onClick={() => onPlay(it)}
                >
                  <Play className="mr-1 h-3.5 w-3.5" /> Reproduzir agora
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive"
                  aria-label="Remover da fila"
                  onClick={() => remove(it)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </span>
            </li>
          );
        })}
        {items.length === 0 ? (
          <li className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Fila vazia.
          </li>
        ) : null}
      </ol>
    </section>
  );
}
