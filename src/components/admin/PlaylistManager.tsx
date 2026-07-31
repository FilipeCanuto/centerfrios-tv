import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  formatDuration,
  parsePlaylistItems,
  type MediaRow,
  type PlaylistItem,
} from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Plus, Trash2, ListVideo, Film, ImageIcon, GripVertical, Play, Clock } from "lucide-react";

type PlaylistState = { id: string; name: string; items: PlaylistItem[] };

export function PlaylistManager() {
  const [playlists, setPlaylists] = useState<PlaylistState[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [newName, setNewName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
    setSelected((cur) => cur || (parsed.length ? parsed[0].id : null));
  }

  useEffect(() => {
    load();
  }, []);

  const current = playlists.find((p) => p.id === selected) || null;

  const byId = useMemo(() => {
    const map: Record<string, MediaRow> = {};
    media.forEach((m) => {
      map[m.id] = m;
    });
    return map;
  }, [media]);

  const totalSeconds = useMemo(() => {
    if (!current) return 0;
    return current.items.reduce((acc, it) => {
      const m = byId[it.media_id];
      if (!m) return acc;
      if (m.type === "video") return acc + (it.custom_duration || m.duration || 30);
      return acc + (it.custom_duration || m.duration || 10);
    }, 0);
  }, [current, byId]);

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
    const ordered = items.map((it, i) => ({ ...it, order: i }));
    setPlaylists((prev) => prev.map((p) => (p.id === current.id ? { ...p, items: ordered } : p)));
    const { error } = await supabase
      .from("playlists")
      .update({ items: ordered as unknown as never })
      .eq("id", current.id);
    if (error) toast.error("Falha ao salvar a playlist");
  }

  function addMedia(mediaId: string) {
    if (!current) return;
    persist(
      current.items.concat([
        { media_id: mediaId, order: current.items.length, custom_duration: null },
      ]),
    );
  }

  function removeAt(index: number) {
    if (!current) return;
    const items = current.items.slice();
    items.splice(index, 1);
    persist(items);
  }

  function setDurationAt(index: number, value: number | null) {
    if (!current) return;
    const items = current.items.slice();
    items[index] = { ...items[index], custom_duration: value };
    persist(items);
  }

  function onDragEnd(event: DragEndEvent) {
    if (!current) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = current.items.map((it, i) => it.media_id + "#" + i);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    persist(arrayMove(current.items, from, to));
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
              Agrupe mídias, arraste para reordenar e defina a duração de cada item.
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
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg font-bold"
                  disabled={current.items.length === 0}
                  onClick={() => setPreviewOpen(true)}
                >
                  <Play className="mr-1.5 h-4 w-4" /> Pré-visualizar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-extrabold text-accent-foreground">
              <Clock className="h-3.5 w-3.5" />
              Duração total: {formatDuration(totalSeconds)}
            </p>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={current.items.map((it, i) => it.media_id + "#" + i)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="mt-4 space-y-2">
                  {current.items.map((it, i) => (
                    <SortableRow
                      key={it.media_id + "#" + i}
                      id={it.media_id + "#" + i}
                      index={i}
                      item={it}
                      media={byId[it.media_id]}
                      onDuration={(v) => setDurationAt(i, v)}
                      onRemove={() => removeAt(i)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>

            {current.items.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Adicione mídias da galeria ao lado.
              </p>
            ) : null}
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

      <PlaylistPreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        name={current?.name || ""}
        items={(current?.items || []).map((it) => ({ item: it, media: byId[it.media_id] }))}
      />

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

function SortableRow({
  id,
  index,
  item,
  media,
  onDuration,
  onRemove,
}: {
  id: string;
  index: number;
  item: PlaylistItem;
  media?: MediaRow;
  onDuration: (value: number | null) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        "flex items-center gap-2 rounded-xl border bg-secondary/40 p-2 " +
        (isDragging ? "border-primary shadow-lg" : "border-border")
      }
    >
      <button
        type="button"
        aria-label="Arrastar para reordenar"
        className="shrink-0 cursor-grab touch-none rounded-lg p-1 text-muted-foreground hover:text-primary active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-extrabold text-primary-foreground">
        {index + 1}
      </span>
      {media ? (
        <span className="h-9 w-14 shrink-0 overflow-hidden rounded-lg bg-foreground/90">
          {media.type === "image" ? (
            <img src={media.url} alt="" className="h-full w-full object-contain" />
          ) : (
            <video src={media.url} muted className="h-full w-full object-contain" />
          )}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {media ? media.title : "Mídia removida"}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        {[5, 10, 30].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onDuration(preset)}
            className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground hover:bg-primary hover:text-primary-foreground"
          >
            {preset}s
          </button>
        ))}
        <Input
          type="number"
          min={1}
          aria-label="Duração em segundos"
          className="h-8 w-16 rounded-lg"
          value={item.custom_duration ?? media?.duration ?? 10}
          onChange={(e) => {
            const num = parseInt(e.target.value, 10);
            onDuration(isNaN(num) ? null : num);
          }}
        />
        <Button
          size="icon"
          variant="ghost"
          aria-label="Remover da playlist"
          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function PlaylistPreview({
  open,
  onOpenChange,
  name,
  items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  items: { item: PlaylistItem; media?: MediaRow }[];
}) {
  const [i, setI] = useState(0);
  const valid = items.filter((x) => !!x.media);
  const currentEntry = valid.length ? valid[i % valid.length] : null;

  useEffect(() => {
    if (!open) setI(0);
  }, [open]);

  useEffect(() => {
    if (!open || !currentEntry || !currentEntry.media) return;
    if (currentEntry.media.type === "video") return;
    const secs =
      currentEntry.item.custom_duration || currentEntry.media.duration || 10;
    const t = setTimeout(() => setI((v) => v + 1), Math.max(1, secs) * 1000);
    return () => clearTimeout(t);
  }, [open, i, currentEntry]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>Pré-visualização — {name}</DialogTitle>
        </DialogHeader>
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          {currentEntry && currentEntry.media ? (
            currentEntry.media.type === "video" ? (
              <video
                key={currentEntry.media.id + "-" + i}
                src={currentEntry.media.url}
                autoPlay
                muted
                playsInline
                onEnded={() => setI((v) => v + 1)}
                onError={() => setI((v) => v + 1)}
                className="h-full w-full object-contain"
              />
            ) : (
              <img
                key={currentEntry.media.id + "-" + i}
                src={currentEntry.media.url}
                alt=""
                className="h-full w-full object-contain"
              />
            )
          ) : null}
        </div>
        <p className="text-center text-xs font-semibold text-muted-foreground">
          Item {valid.length ? (i % valid.length) + 1 : 0} de {valid.length}
        </p>
      </DialogContent>
    </Dialog>
  );
}
