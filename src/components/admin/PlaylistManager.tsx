import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  formatDuration,
  hasSchedule,
  parsePlaylistItems,
  type MediaRow,
  type PlaylistItem,
} from "@/lib/centerfrios";
import { parseYoutubeId } from "@/components/admin/MediaManager";
import { PlayReport } from "@/components/admin/PlayReport";
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
import {
  Plus,
  Trash2,
  ListVideo,
  Film,
  ImageIcon,
  GripVertical,
  Play,
  Clock,
  Search,
  Eraser,
  Youtube,
} from "lucide-react";

type PlaylistState = { id: string; name: string; items: PlaylistItem[] };

export function PlaylistManager({ active = true }: { active?: boolean } = {}) {
  const [playlists, setPlaylists] = useState<PlaylistState[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [newName, setNewName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "youtube" | "video" | "image">("all");
  const [cleaning, setCleaning] = useState(false);

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

  // recarrega sempre que a aba volta a ficar visível (ex.: acabou de enviar mídias na aba Mídias)
  useEffect(() => {
    if (active) load();
  }, [active]);

  const current = playlists.find((p) => p.id === selected) || null;

  const byId = useMemo(() => {
    const map: Record<string, MediaRow> = {};
    media.forEach((m) => {
      map[m.id] = m;
    });
    return map;
  }, [media]);

  // quantas vezes cada mídia já está na playlist aberta (selo "na playlist")
  const inPlaylist = useMemo(() => {
    const c: Record<string, number> = {};
    (current?.items || []).forEach((it) => {
      c[it.media_id] = (c[it.media_id] || 0) + 1;
    });
    return c;
  }, [current]);

  // galeria filtrada: busca por nome (sem acento) + tipo
  const filteredMedia = useMemo(() => {
    const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const q = norm(query.trim());
    return media.filter(
      (m) =>
        (typeFilter === "all" || m.type === typeFilter) && (!q || norm(m.title || "").includes(q)),
    );
  }, [media, query, typeFilter]);

  // itens que apontam para mídias que não existem mais (excluídas da galeria), em TODAS as playlists
  const orphanTotal = useMemo(
    () => playlists.reduce((acc, p) => acc + p.items.filter((it) => !byId[it.media_id]).length, 0),
    [playlists, byId],
  );

  async function removeOrphans() {
    if (!orphanTotal || cleaning) return;
    setCleaning(true);
    const dirty = playlists.filter((p) => p.items.some((it) => !byId[it.media_id]));
    const results = await Promise.all(
      dirty.map((p) => {
        const items = p.items
          .filter((it) => byId[it.media_id])
          .map((it, i) => ({ ...it, order: i }));
        return supabase
          .from("playlists")
          .update({ items: items as unknown as never })
          .eq("id", p.id);
      }),
    );
    setCleaning(false);
    if (results.some((r) => r.error)) toast.error("Algumas playlists não puderam ser limpas");
    else
      toast.success(
        orphanTotal +
          (orphanTotal === 1 ? " mídia removida foi tirada" : " mídias removidas foram tiradas") +
          " das playlists",
      );
    load();
  }

  const youtubeCount = useMemo(
    () =>
      current ? current.items.filter((it) => byId[it.media_id]?.type === "youtube").length : 0,
    [current, byId],
  );

  const totalSeconds = useMemo(() => {
    if (!current) return 0;
    return current.items.reduce((acc, it) => {
      const m = byId[it.media_id];
      if (!m) return acc;
      // YouTube toca até o fim (duração desconhecida): não entra na soma, só no aviso.
      if (m.type === "youtube") return acc;
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
    const m = byId[mediaId];
    toast.success("Adicionado: " + (m?.title || "mídia"), { duration: 1500 });
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

  function setSchedAt(index: number, patch: Partial<PlaylistItem> | null) {
    if (!current) return;
    const items = current.items.slice();
    const base: PlaylistItem = {
      media_id: items[index].media_id,
      order: items[index].order,
      custom_duration: items[index].custom_duration ?? null,
    };
    // patch null = limpa a agenda; senão mescla e remove campos vazios
    const merged: Record<string, unknown> = patch === null ? base : { ...items[index], ...patch };
    ["days", "start", "end", "from", "until"].forEach((k) => {
      const v = merged[k];
      if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete merged[k];
    });
    items[index] = merged as unknown as PlaylistItem;
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
              title={p.name}
              onClick={() => setSelected(p.id)}
              className={
                "inline-flex max-w-full items-center rounded-full border px-4 py-1.5 text-sm font-bold transition-colors " +
                (p.id === selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary")
              }
            >
              <span className="min-w-0 max-w-[16rem] truncate">{p.name}</span>
              <span className="ml-2 shrink-0 text-xs font-semibold opacity-70">
                {p.items.length}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">Nenhuma playlist criada.</p>
      )}

      {orphanTotal > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="min-w-0 text-sm font-semibold">
            {orphanTotal === 1
              ? "1 item das playlists aponta para uma mídia que foi excluída da galeria."
              : orphanTotal +
                " itens das playlists apontam para mídias que foram excluídas da galeria."}
          </p>
          <Button
            size="sm"
            variant="destructive"
            disabled={cleaning}
            onClick={removeOrphans}
            className="shrink-0 rounded-xl font-bold"
          >
            <Eraser className="mr-1.5 h-4 w-4" />
            {cleaning ? "Removendo…" : "Remover todas as mídias removidas"}
          </Button>
        </div>
      ) : null}

      {current ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="cf-card min-w-0 p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <h3 className="cf-title text-base font-extrabold" title={current.name}>
                {current.name}
              </h3>
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

            <p className="mt-2 inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-extrabold text-accent-foreground">
              <Clock className="h-3.5 w-3.5" />
              Duração total: {formatDuration(totalSeconds)}
              {youtubeCount > 0
                ? " + " +
                  youtubeCount +
                  (youtubeCount === 1 ? " vídeo do YouTube" : " vídeos do YouTube") +
                  " (tocam até o fim)"
                : ""}
            </p>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={current.items.map((it, i) => it.media_id + "#" + i)}
                strategy={verticalListSortingStrategy}
              >
                {/* rolagem própria: a lista não empurra a galeria para baixo em telas grandes */}
                <ul className="mt-4 space-y-2 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
                  {current.items.map((it, i) => (
                    <SortableRow
                      key={it.media_id + "#" + i}
                      id={it.media_id + "#" + i}
                      index={i}
                      item={it}
                      media={byId[it.media_id]}
                      onDuration={(v) => setDurationAt(i, v)}
                      onSched={(v) => setSchedAt(i, v)}
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

          <section className="cf-card min-w-0 p-5 lg:sticky lg:top-4 lg:self-start">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-base font-extrabold">Galeria de mídias</h3>
              <span className="text-xs text-muted-foreground">
                {filteredMedia.length} de {media.length}
              </span>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar mídia pelo nome…"
                className="h-10 rounded-xl pl-9"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ["all", "Todas"],
                  ["youtube", "YouTube"],
                  ["video", "Vídeos"],
                  ["image", "Imagens"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTypeFilter(k)}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-bold transition-colors " +
                    (typeFilter === k
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-primary")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <ul className="mt-3 grid gap-2 lg:max-h-[62vh] lg:overflow-y-auto lg:pr-1">
              {filteredMedia.map((m) => {
                const count = inPlaylist[m.id] || 0;
                return (
                  <li
                    key={m.id}
                    className={
                      "flex min-w-0 items-center gap-2 rounded-xl border p-2 " +
                      (count ? "border-primary/40 bg-secondary/40" : "border-border")
                    }
                  >
                    <MediaThumb media={m} />
                    <div className="min-w-0 flex-1">
                      <p className="cf-title text-sm font-semibold leading-snug" title={m.title}>
                        {m.title}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {m.type === "youtube" ? (
                          <Youtube className="h-3 w-3" />
                        ) : m.type === "video" ? (
                          <Film className="h-3 w-3" />
                        ) : (
                          <ImageIcon className="h-3 w-3" />
                        )}
                        {m.type === "youtube"
                          ? "YouTube"
                          : m.resolution || (m.type === "video" ? "Vídeo" : "Imagem")}
                        {count ? (
                          <span className="ml-1 rounded-full bg-primary px-1.5 py-px text-[10px] font-extrabold text-primary-foreground">
                            na playlist{count > 1 ? " ×" + count : ""}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label="Adicionar à playlist"
                      title="Adicionar ao fim da playlist"
                      className="h-9 w-9 shrink-0 rounded-lg"
                      onClick={() => addMedia(m.id)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
              {media.length === 0 ? (
                <p className="text-sm text-muted-foreground">Envie mídias primeiro.</p>
              ) : filteredMedia.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma mídia encontrada.</p>
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
      <PlayReport />
    </div>
  );
}

function SortableRow({
  id,
  index,
  item,
  media,
  onDuration,
  onSched,
  onRemove,
}: {
  id: string;
  index: number;
  item: PlaylistItem;
  media?: MediaRow;
  onDuration: (value: number | null) => void;
  onSched: (patch: Partial<PlaylistItem> | null) => void;
  onRemove: () => void;
}) {
  const [schedOpen, setSchedOpen] = useState(false);
  const scheduled = hasSchedule(item);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        "flex flex-wrap items-center gap-2 rounded-xl border bg-secondary/40 p-2 " +
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
      {media ? <MediaThumb media={media} small /> : null}
      <span
        className={
          "cf-title flex-1 basis-40 text-sm font-semibold leading-snug " +
          (media ? "" : "italic text-destructive")
        }
        title={media ? media.title : "Mídia removida da galeria"}
      >
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
          aria-label="Agenda do item"
          title="Agenda: dias, horário e validade"
          className={
            "h-8 w-8 rounded-lg " +
            (scheduled ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-primary")
          }
          onClick={() => setSchedOpen((v) => !v)}
        >
          <Clock className="h-4 w-4" />
        </Button>
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
      {schedOpen ? <SchedEditor item={item} onSched={onSched} /> : null}
    </li>
  );
}

// Miniatura: capa do YouTube (nunca tenta abrir o link do YouTube como vídeo), imagem ou vídeo.
function MediaThumb({ media, small }: { media: MediaRow; small?: boolean }) {
  const ytId = media.type === "youtube" ? parseYoutubeId(media.url) : null;
  return (
    <span
      className={
        (small ? "h-9 w-14" : "h-10 w-16") + " shrink-0 overflow-hidden rounded-lg bg-foreground/90"
      }
    >
      {media.type === "youtube" ? (
        ytId ? (
          <img
            src={"https://i.ytimg.com/vi/" + ytId + "/mqdefault.jpg"}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : null
      ) : media.type === "image" ? (
        <img src={media.url} alt="" loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <video src={media.url} muted preload="metadata" className="h-full w-full object-contain" />
      )}
    </span>
  );
}

const WEEK = ["D", "S", "T", "Q", "Q", "S", "S"];

function SchedEditor({
  item,
  onSched,
}: {
  item: PlaylistItem;
  onSched: (patch: Partial<PlaylistItem> | null) => void;
}) {
  const days = item.days || [];
  return (
    <div className="basis-full space-y-2 rounded-lg border border-border bg-background p-2 text-xs">
      <p className="font-semibold text-muted-foreground">
        Agenda deste item — vazio = toca sempre. Fora da agenda ele é pulado; se nada estiver
        programado, a TV mostra a tela institucional.
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 font-bold">Dias:</span>
        {WEEK.map((label, d) => (
          <button
            key={d}
            type="button"
            aria-label={"Dia " + d}
            onClick={() =>
              onSched({
                days: days.includes(d) ? days.filter((x) => x !== d) : days.concat([d]).sort(),
              })
            }
            className={
              "h-7 w-7 rounded-md text-[11px] font-bold " +
              (days.includes(d)
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-primary/20")
            }
          >
            {label}
          </button>
        ))}
        <span className="ml-1 text-muted-foreground">(nenhum marcado = todos os dias)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 font-bold">
          Das
          <Input
            type="time"
            aria-label="Hora inicial"
            className="h-8 w-28 rounded-lg"
            value={item.start || ""}
            onChange={(e) => onSched({ start: e.target.value || null })}
          />
        </label>
        <label className="flex items-center gap-1 font-bold">
          às
          <Input
            type="time"
            aria-label="Hora final"
            className="h-8 w-28 rounded-lg"
            value={item.end || ""}
            onChange={(e) => onSched({ end: e.target.value || null })}
          />
        </label>
        <label className="flex items-center gap-1 font-bold">
          Válido de
          <Input
            type="date"
            aria-label="Válido a partir de"
            className="h-8 w-36 rounded-lg"
            value={item.from || ""}
            onChange={(e) => onSched({ from: e.target.value || null })}
          />
        </label>
        <label className="flex items-center gap-1 font-bold">
          até
          <Input
            type="date"
            aria-label="Válido até"
            className="h-8 w-36 rounded-lg"
            value={item.until || ""}
            onChange={(e) => onSched({ until: e.target.value || null })}
          />
        </label>
        <button
          type="button"
          onClick={() => onSched(null)}
          className="rounded-md bg-muted px-2 py-1 font-bold text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          Limpar agenda
        </button>
      </div>
    </div>
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
    const secs = currentEntry.item.custom_duration || currentEntry.media.duration || 10;
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
            currentEntry.media.type === "youtube" ? (
              <iframe
                key={currentEntry.media.id + "-" + i}
                src={
                  "https://www.youtube.com/embed/" +
                  (parseYoutubeId(currentEntry.media.url) || "") +
                  "?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0"
                }
                title={currentEntry.media.title}
                allow="autoplay; encrypted-media"
                className="h-full w-full border-0"
              />
            ) : currentEntry.media.type === "video" ? (
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
