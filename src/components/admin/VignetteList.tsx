// Uma lista de vinhetas (vertical OU horizontal): colar link do YouTube, ordenar, ativar, remover.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractYoutubeId, type Vignette } from "@/lib/centerfrios";
import { fetchYoutubeTitle, youtubeThumb } from "@/lib/endomarketing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

export function VignetteList({
  orientation,
  items,
  onChanged,
}: {
  orientation: "portrait" | "landscape";
  items: Vignette[];
  onChanged: () => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const label = orientation === "portrait" ? "vertical" : "horizontal";

  async function add() {
    const id = extractYoutubeId(url);
    if (!id) return toast.error("Link do YouTube inválido");
    setBusy(true);
    const name = title.trim() || (await fetchYoutubeTitle(id));
    const max = items.reduce((m, v) => Math.max(m, v.order_index), 0);
    const { error } = await supabase.from("vignettes").insert({
      orientation,
      youtube_url: url.trim(),
      video_id: id,
      title: name,
      order_index: max + 1,
    });
    setBusy(false);
    if (error)
      return toast.error("Não foi possível adicionar (a migration das vinhetas já foi aplicada?)");
    setUrl("");
    setTitle("");
    toast.success("Vinheta " + label + " adicionada");
    onChanged();
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    const tmp = next[index];
    next[index] = next[j];
    next[j] = tmp;
    // regrava a ordem 1..n (listas curtas)
    const res = await Promise.all(
      next.map((v, i) =>
        supabase
          .from("vignettes")
          .update({ order_index: i + 1 })
          .eq("id", v.id),
      ),
    );
    if (res.some((r) => r.error)) toast.error("Não foi possível reordenar");
    onChanged();
  }

  async function setActive(v: Vignette, active: boolean) {
    const { error } = await supabase.from("vignettes").update({ active }).eq("id", v.id);
    if (error) toast.error("Não foi possível alterar");
    onChanged();
  }

  async function remove(v: Vignette) {
    if (!window.confirm('Remover a vinheta "' + (v.title || v.video_id) + '"?')) return;
    const { error } = await supabase.from("vignettes").delete().eq("id", v.id);
    if (error) return toast.error("Não foi possível remover");
    onChanged();
  }

  const activeCount = items.filter((v) => v.active).length;
  // posição de cada vinheta ATIVA na alternância (1ª ativa = antes do item 1, 2ª = antes do item 2...)
  const activePos: Record<string, number> = {};
  items
    .filter((v) => v.active)
    .forEach((v, k) => {
      activePos[v.id] = k + 1;
    });

  return (
    <section className="cf-card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-extrabold">
          Vinhetas{" "}
          {orientation === "portrait" ? "verticais (TV em pé)" : "horizontais (TV deitada)"}
        </h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {activeCount} ativa{activeCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] sm:items-end">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=... ou youtu.be/..."
          className="h-10 rounded-xl"
          aria-label={"Link do YouTube da vinheta " + label}
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nome (opcional)"
          className="h-10 rounded-xl"
          aria-label="Nome da vinheta"
        />
        <Button onClick={add} disabled={busy || !url.trim()} className="h-10 rounded-xl font-bold">
          <Plus className="mr-1 h-4 w-4" /> {busy ? "Buscando…" : "Adicionar"}
        </Button>
      </div>

      <ol className="mt-4 grid gap-2">
        {items.map((v, i) => (
          <li
            key={v.id}
            className={
              "flex min-w-0 items-center gap-3 rounded-xl border p-2 " +
              (v.active
                ? "border-border bg-card"
                : "border-dashed border-border bg-muted/40 opacity-70")
            }
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-extrabold text-primary-foreground">
              {i + 1}
            </span>
            <img
              src={youtubeThumb(v.video_id)}
              alt=""
              loading="lazy"
              className={
                "shrink-0 rounded-md bg-black object-cover " +
                (orientation === "portrait" ? "h-16 w-9" : "h-10 w-16")
              }
            />
            <span className="min-w-0 flex-1">
              <span className="cf-title text-sm font-bold" title={v.title || v.youtube_url}>
                {v.title || "Vídeo " + v.video_id}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {v.active
                  ? "antes do item " +
                    activePos[v.id] +
                    " da playlist" +
                    (activeCount > 1
                      ? " (repete a cada " + activeCount + " itens)"
                      : " (antes de todos)")
                  : "desativada (não toca)"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Switch
                checked={v.active}
                onCheckedChange={(x) => setActive(v, x)}
                aria-label="Vinheta ativa"
              />
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
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                aria-label="Remover vinheta"
                onClick={() => remove(v)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </span>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Nenhuma vinheta {label}. Cole um link do YouTube acima.
          </li>
        ) : null}
      </ol>
    </section>
  );
}
