import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parsePlaylistItems, type MediaRow, type PlaylistItem } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

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
    setPlaylists((prev) =>
      prev.map((p) => (p.id === current.id ? { ...p, items } : p)),
    );
    const { error } = await supabase
      .from("playlists")
      .update({ items: items as unknown as never })
      .eq("id", current.id);
    if (error) toast.error("Falha ao salvar a playlist");
  }

  function addMedia(mediaId: string) {
    if (!current) return;
    const items = current.items.concat([
      { media_id: mediaId, order: current.items.length, custom_duration: null },
    ]);
    persist(reorder(items));
  }

  function reorder(items: PlaylistItem[]): PlaylistItem[] {
    return items.map((it, i) => ({ ...it, order: i }));
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

  async function removePlaylist(id: string) {
    if (!window.confirm("Excluir esta playlist?")) return;
    const { error } = await supabase.from("playlists").delete().eq("id", id);
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
    <div className="space-y-4">
      <Card className="p-4">
        <Label htmlFor="pl-name">Nova playlist</Label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="pl-name"
            value={newName}
            placeholder="Ex: Vitrine — Ofertas da semana"
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button onClick={createPlaylist} className="font-bold">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {playlists.length ? (
        <div className="flex flex-wrap gap-2">
          {playlists.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={p.id === selected ? "default" : "outline"}
              onClick={() => setSelected(p.id)}
            >
              {p.name}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma playlist criada.</p>
      )}

      {current ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">{current.name}</h3>
              <Button size="sm" variant="ghost" onClick={() => removePlaylist(current.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <ul className="mt-3 space-y-2">
              {current.items.map((it, i) => {
                const m = byId[it.media_id];
                return (
                  <li
                    key={it.media_id + "-" + i}
                    className="flex items-center gap-2 rounded-md border border-border p-2"
                  >
                    <span className="w-6 text-xs font-bold text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {m ? m.title : "Mídia removida"}
                    </span>
                    {m && m.type === "image" ? (
                      <Input
                        type="number"
                        min={3}
                        className="h-8 w-20"
                        value={it.custom_duration ?? m.duration}
                        onChange={(e) => setDurationAt(i, e.target.value)}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">vídeo</span>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => move(i, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => move(i, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => removeAt(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                );
              })}
              {current.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Adicione mídias da lista ao lado.
                </p>
              ) : null}
            </ul>
          </Card>

          <Card className="p-4">
            <h3 className="font-bold">Mídias disponíveis</h3>
            <ul className="mt-3 space-y-2">
              {media.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-md border border-border p-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{m.title}</span>
                  <Button size="sm" variant="outline" onClick={() => addMedia(m.id)}>
                    <Plus className="mr-1 h-3 w-3" /> Adicionar
                  </Button>
                </li>
              ))}
              {media.length === 0 ? (
                <p className="text-sm text-muted-foreground">Envie mídias primeiro.</p>
              ) : null}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
