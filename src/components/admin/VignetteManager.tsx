// Aba "Vinhetas": várias playlists de vinhetas (com nome), cada TV recebe a sua.
// A TV alterna vinheta 1, item 1, vinheta 2, item 2... e cada sequência segue até o fim antes
// de recomeçar (nenhuma vinheta fica de fora, sem limite de quantidade).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { makeNonce, type Vignette, type VignettePlaylist } from "@/lib/centerfrios";
import { VignetteList } from "@/components/admin/VignetteList";
import { VignetteTvAssign, type TvLite } from "@/components/admin/VignetteTvAssign";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Clapperboard, Plus, RefreshCw, Trash2 } from "lucide-react";

export function VignetteManager() {
  const [playlists, setPlaylists] = useState<VignettePlaylist[]>([]);
  const [vignettes, setVignettes] = useState<Vignette[]>([]);
  const [tvs, setTvs] = useState<TvLite[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newOri, setNewOri] = useState<"portrait" | "landscape">("portrait");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [pl, vg, tv] = await Promise.all([
      supabase.from("vignette_playlists").select("*").order("created_at", { ascending: true }),
      supabase
        .from("vignettes")
        .select("*")
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("tvs")
        .select("id,name,orientation,last_ping,vignette_playlist_id")
        .order("created_at"),
    ]);
    if (pl.error) {
      toast.error(
        "Não foi possível carregar as vinhetas (a migration das playlists de vinhetas já foi aplicada?)",
      );
      return;
    }
    const list = (pl.data || []) as unknown as VignettePlaylist[];
    setPlaylists(list);
    setVignettes((vg.data || []) as unknown as Vignette[]);
    setTvs((tv.data || []) as unknown as TvLite[]);
    setSelected((cur) =>
      cur && list.some((p) => p.id === cur) ? cur : list.length ? list[0].id : null,
    );
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("vignettes-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "vignettes" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "vignette_playlists" }, () =>
        load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const current = playlists.find((p) => p.id === selected) || null;
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    playlists.forEach((p) => (m[p.id] = p.name));
    return m;
  }, [playlists]);
  const items = vignettes.filter((v) => v.playlist_id === selected);
  const usedBy = tvs.filter((t) => current && t.vignette_playlist_id === current.id);

  async function create() {
    const name = newName.trim();
    if (!name) return toast.error("Dê um nome à playlist de vinhetas");
    const { data, error } = await supabase
      .from("vignette_playlists")
      .insert({ name, orientation: newOri })
      .select()
      .maybeSingle();
    if (error || !data) return toast.error("Não foi possível criar");
    setNewName("");
    await load();
    setSelected((data as { id: string }).id);
    toast.success("Playlist de vinhetas criada");
  }

  async function removePlaylist() {
    if (!current) return;
    if (
      !window.confirm(
        'Excluir a playlist de vinhetas "' +
          current.name +
          '" e seus ' +
          items.length +
          " vídeos? As TVs que a usam ficam sem vinhetas.",
      )
    )
      return;
    const { error } = await supabase.from("vignette_playlists").delete().eq("id", current.id);
    if (error) return toast.error("Não foi possível excluir");
    toast.success("Playlist de vinhetas excluída");
    setSelected(null);
    load();
  }

  // As TVs reconferem sozinhas a cada 5 min; este botão manda sincronizar na hora.
  async function syncNow() {
    if (!usedBy.length) return toast.error("Nenhuma TV usa esta playlist (marque abaixo)");
    setSyncing(true);
    const res = await Promise.all(
      usedBy.map((t) =>
        supabase
          .from("tvs")
          .update({ command: { action: "sync", nonce: makeNonce() } as never })
          .eq("id", t.id),
      ),
    );
    setSyncing(false);
    if (res.some((r) => r.error)) toast.error("Algumas TVs não receberam o comando");
    else toast.success("Aplicado em " + usedBy.length + (usedBy.length === 1 ? " TV" : " TVs"));
  }

  return (
    <div className="grid gap-5">
      <section className="cf-card p-5">
        <div className="flex min-w-0 items-start gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <Clapperboard className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">Playlists de vinhetas</h3>
            <p className="text-xs text-muted-foreground">
              Crie quantas quiser e escolha qual vai para cada TV. A TV alterna: vinheta 1, item 1
              da playlist, vinheta 2, item 2… Cada sequência vai até o fim antes de recomeçar, então
              todas as vinhetas tocam, mesmo sendo mais que os itens. Mudanças chegam às TVs em até
              5 min.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ex.: Vinhetas Loja Tabuleiro (vertical)"
            className="h-10 rounded-xl"
            aria-label="Nome da nova playlist de vinhetas"
          />
          <div className="flex gap-1 rounded-xl border border-border p-1">
            {(
              [
                ["portrait", "Vertical"],
                ["landscape", "Horizontal"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setNewOri(k)}
                className={
                  "flex-1 rounded-lg px-3 py-1.5 text-xs font-bold " +
                  (newOri === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")
                }
              >
                {label}
              </button>
            ))}
          </div>
          <Button onClick={create} className="h-10 rounded-xl font-bold">
            <Plus className="mr-1 h-4 w-4" /> Criar
          </Button>
        </div>
      </section>

      {playlists.length ? (
        <div className="flex flex-wrap gap-2">
          {playlists.map((p) => {
            const n = vignettes.filter((v) => v.playlist_id === p.id).length;
            const t = tvs.filter((x) => x.vignette_playlist_id === p.id).length;
            return (
              <button
                key={p.id}
                type="button"
                title={p.name}
                onClick={() => setSelected(p.id)}
                className={
                  "inline-flex max-w-full items-center rounded-full border px-4 py-1.5 text-sm font-bold transition-colors " +
                  (p.id === selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-primary")
                }
              >
                <span className="min-w-0 max-w-[16rem] truncate">{p.name}</span>
                <span className="ml-2 shrink-0 text-xs font-semibold opacity-75">
                  {p.orientation === "portrait" ? "vertical" : "horizontal"} · {n} vídeo
                  {n === 1 ? "" : "s"} · {t} TV{t === 1 ? "" : "s"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">Nenhuma playlist de vinhetas criada.</p>
      )}

      {current ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="cf-title min-w-0 text-lg font-extrabold" title={current.name}>
              {current.name}
            </h3>
            <div className="flex shrink-0 gap-2">
              <Button
                onClick={syncNow}
                disabled={syncing}
                variant="secondary"
                className="rounded-xl font-bold"
              >
                <RefreshCw className={"mr-1.5 h-4 w-4 " + (syncing ? "animate-spin" : "")} />
                Aplicar agora ({usedBy.length})
              </Button>
              <Button
                onClick={removePlaylist}
                variant="ghost"
                className="rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Excluir playlist de vinhetas"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <VignetteList
              playlistId={current.id}
              orientation={current.orientation}
              items={items}
              onChanged={load}
            />
            <VignetteTvAssign
              playlistId={current.id}
              playlistNames={names}
              tvs={tvs}
              onChanged={load}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
