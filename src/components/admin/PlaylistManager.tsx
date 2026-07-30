import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parsePlaylistItems, type MediaRow, type PlaylistItem } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2, ListVideo, Film, ImageIcon } from "lucide-react";

type PlaylistState = {
  id: string;
  name: string;
  items: PlaylistItem[];
};

export function PlaylistManager() {
  const [playlists, setPlaylists] = useState<PlaylistState[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [newName, setNewName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function load() {
    const [{ data: pls }, { data: ms }] = await Promise.all([
      supabase.from("playlists").select("*").order("created_at", { ascending: true }),
      supabase.from("media").select("*").order("created_at", { ascending: false }),
    ]);
    const parsed = ((pls || []) as unknown as { id: string; name: string; items: unknown }[]).map(
      (p) => ({ id: p.id, name: p.name, items: parsePlaylistItems(p.items) }),
    );
    setPlaylists(parsed);
    setMedia((ms || []) as unknown as MediaRow[]);
    if (!selected && parsed.length) setSelected(parsed[0].id);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = playlists.find((p) => p.id === selected) || null;

  async function createPlaylist() {
    if (!newName.trim()) return;
    const { data, error } = await supabase
      .from("playlists")
      .insert({ name: newName.trim(), items: [] })
      .select()
      .maybeSingle();
    if (error || !data) {
      toast.error("Não foi possível criar a playlist");
      return;
    }
    setNewName("");
    await load();
    setSelected((data as { id: string }).id);
    toast.success("Playlist criada");
  }

  async function persist(items: PlaylistItem[]) {
    if (!current) return;
    setPlaylists((prev) => prev.map((p) => (p.id === current.id ? { ...p, items } : p)));
    const { error } = await supabase
      .from("playlists")
      .update({ items: items as unknown as never })
      .eq("id", current.id);
    if (error) toast.error("Falha ao salvar a playlist");
  }

  function reorder(items: PlaylistItem[]): PlaylistItem[] {
    return items.map((it, i) => ({ ...it, order: i }));
  }

  function addMedia(mediaId: string) {
    if (!current) return;
    const items = current.items.concat([
      { media_id: mediaId, order: current.items.length, custom_duration: null },
    ]);
    persist(reorder(items));
  }

  function move(index: number, delta: number) {
    if (!current) return;
    const items = current.items.slice();
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const tmp = items[index];
    items[index] = items[target];
    items[target] = tmp;
    persist(reorder(items));
  }

  function removeAt(index: number) {
    if (!current) return;
    const items = current.items.slice();
    items.splice(index, 1);
    persist(reorder(items));
  }

  function setDurationAt(index: number, value: string) {
    if (!current) return;
    const items = current.items.slice();
    const num = parseInt(value, 10);
    items[index] = { ...items[index], custom_duration: isNaN(num) ? null : num };
    persist(items);
  }

  async function removePlaylist() {
    setConfirmDelete(false);
    if (!current) return;
    const { error } = await supabase.from("playlists").delete().eq("id", current.id);
    if (error) {
      toast.error("Não foi possível excluir");
      return;
    }
    setSelected(null);
    load();
  }

  const byId: Record<string, MediaRow> = {};
  media.forEach((m) => {
    byId[m.id] = m;
  });

  return (
    <div className="space-y-5">
      <section className="cf-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <ListVideo className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">Nova playlist</h3>
            <p className="text-xs text-muted-foreground">
              Agrupe mídias e defina a sequência de exibição.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Input
            id="pl-name"
            value={newName}
            placeholder="Ex: Vitrine — Ofertas da semana"
            onChange={(e) => setNewName(e.target.value)}
            className="h-11 rounded-xl"
          />
          <Button onClick={createPlaylist} className="h-11 rounded-xl px-5 font-bold">
            <Plus className="mr-1.5 h-4 w-4" /> Criar
          </Button>
        </div>
      </section>

      {playlists.length ? (
        <div className="flex flex-wrap gap-2">
          {playlists.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p.id)}
              className={
                "rounded-full border px-4 py-1.5 text-sm font-bold transition-colors " +
                (p.id === selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary")
              }
            >
              {p.name}
              <span className="ml-2 text-xs font-semibold opacity-70">{p.items.length}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">Nenhuma playlist criada.</p>
      )}

      {current ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="cf-card p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <h3 className="truncate text-base font-extrabold">{current.name}</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
              </Button>
            </div>

            <ul className="mt-4 space-y-2">
              {current.items.map((it, i) => {
                const m = byId[it.media_id];
                return (
                  <li
                    key={it.media_id + "-" + i}
                    className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 p-2"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-extrabold text-primary-foreground">
                      {i + 1}
                    </span>
                    {m ? (
                      <span className="h-9 w-14 shrink-0 overflow-hidden rounded-lg bg-foreground/90">
                        {m.type === "image" ? (
                          <img src={m.url} alt="" className="h-full w-full object-contain" />
                        ) : (
                          <video src={m.url} muted className="h-full w-full object-contain" />
                        )}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {m ? m.title : "Mídia removida"}
                    </span>
                    {m && m.type === "image" ? (
                      <Input
                        type="number"
                        min={3}
                        aria-label="Duração em segundos"
                        className="h-8 w-16 rounded-lg"
                        value={it.custom_duration ?? m.duration}
                        onChange={(e) => setDurationAt(i, e.target.value)}
                      />
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground">vídeo</span>
                    )}
                    <div className="flex shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Subir"
                        className="h-8 w-8 rounded-lg"
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Descer"
                        className="h-8 w-8 rounded-lg"
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remover da playlist"
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeAt(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
              {current.items.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  Adicione mídias da galeria ao lado.
                </p>
              ) : null}
            </ul>
          </section>

          <section className="cf-card p-5">
            <h3 className="text-base font-extrabold">Galeria de mídias</h3>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {media.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-xl border border-border p-2"
                >
                  <span className="h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-foreground/90">
                    {m.type === "image" ? (
                      <img src={m.url} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <video src={m.url} muted className="h-full w-full object-contain" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{m.title}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      {m.type === "video" ? (
                        <Film className="h-3 w-3" />
                      ) : (
                        <ImageIcon className="h-3 w-3" />
                      )}
                      {m.resolution || (m.type === "video" ? "Vídeo" : "Imagem")}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Adicionar à playlist"
                    className="h-8 w-8 shrink-0 rounded-lg"
                    onClick={() => addMedia(m.id)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </li>
              ))}
              {media.length === 0 ? (
                <p className="text-sm text-muted-foreground">Envie mídias primeiro.</p>
              ) : null}
            </ul>
          </section>
        </div>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{current?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              As TVs vinculadas a esta playlist ficarão sem conteúdo até receberem outra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={removePlaylist}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
