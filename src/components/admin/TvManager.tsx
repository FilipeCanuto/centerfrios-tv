import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isOnline, makeNonce, type TvRow } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Trash2,
  Tv,
  Plus,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Volume2,
  VolumeX,
  MonitorSmartphone,
  LayoutGrid,
  Maximize,
  Cpu,
  MonitorCheck,
} from "lucide-react";

export function TvManager({ onChanged }: { onChanged?: () => void }) {
  const [tvs, setTvs] = useState<TvRow[]>([]);
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TvRow | null>(null);

  async function load() {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from("tvs").select("*").order("created_at", { ascending: true }),
      supabase.from("playlists").select("id, name").order("created_at", { ascending: true }),
    ]);
    setTvs((t || []) as unknown as TvRow[]);
    setPlaylists((p || []) as unknown as { id: string; name: string }[]);
    if (onChanged) onChanged();
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("admin-tvs")
      .on("postgres_changes", { event: "*", schema: "public", table: "tvs" }, () => load())
      .subscribe();
    const interval = setInterval(load, 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pair() {
    if (code.trim().length !== 6) {
      toast.error("Informe o código de 6 dígitos exibido na TV");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("tvs")
      .update({ is_paired: true, name: name.trim() || "TV CENTERFRIOS" })
      .eq("pairing_code", code.trim())
      .select();
    setBusy(false);
    if (error || !data || data.length === 0) {
      toast.error("Código não encontrado. Verifique a tela da TV.");
      return;
    }
    setCode("");
    setName("");
    toast.success("TV pareada com sucesso");
    load();
  }

  async function patchTv(tvId: string, changes: Record<string, unknown>, message?: string) {
    setTvs((prev) => prev.map((t) => (t.id === tvId ? ({ ...t, ...changes } as TvRow) : t)));
    const { error } = await supabase.from("tvs").update(changes as never).eq("id", tvId);

    if (error) {
      toast.error("Falha ao aplicar a alteração");
      load();
      return;
    }
    if (message) toast.success(message);
  }

  function sendCommand(tv: TvRow, action: "reload" | "mute" | "unmute" | "sync") {
    const labels: Record<string, string> = {
      reload: "Reiniciando o player…",
      mute: "Som desativado na TV",
      unmute: "Som ativado na TV",
      sync: "Sincronização forçada",
    };
    const changes: Record<string, unknown> = { command: { action, nonce: makeNonce() } };
    if (action === "mute") changes.muted = true;
    if (action === "unmute") changes.muted = false;
    patchTv(tv.id, changes, labels[action]);
  }

  async function rename(tvId: string, value: string) {
    await supabase.from("tvs").update({ name: value }).eq("id", tvId);
  }

  async function confirmRemove() {
    if (!pendingDelete) return;
    const { error } = await supabase.from("tvs").delete().eq("id", pendingDelete.id);
    setPendingDelete(null);
    if (error) {
      toast.error("Não foi possível remover");
      return;
    }
    toast.success("TV removida");
    load();
  }

  const onlineCount = tvs.filter((t) => isOnline(t.last_ping)).length;

  return (
    <div className="space-y-5">
      <section className="cf-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <KeyRound className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">Parear nova TV</h3>
            <p className="text-xs text-muted-foreground">
              Digite o código exibido na tela do player.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[150px_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="code">Código</Label>
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="h-11 rounded-xl text-center text-lg font-extrabold tracking-[0.35em]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tvname">Nome da TV</Label>
            <Input
              id="tvname"
              placeholder="TV Vitrine — Filial Tabuleiro"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
          <Button onClick={pair} disabled={busy} className="h-11 rounded-xl px-6 font-bold">
            <Plus className="mr-1.5 h-4 w-4" /> Parear
          </Button>
        </div>
      </section>

      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted-foreground">
          Telas cadastradas
        </h3>
        <span className="text-xs font-semibold text-muted-foreground">
          {onlineCount} de {tvs.length} online
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {tvs.map((tv) => {
          const online = isOnline(tv.last_ping);
          return (
            <article key={tv.id} className="cf-card p-5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                    <Tv className="h-4 w-4" />
                  </span>
                  <Input
                    defaultValue={tv.name}
                    onBlur={(e) => rename(tv.id, e.target.value)}
                    className="h-9 rounded-lg border-transparent bg-transparent px-1.5 text-base font-bold hover:border-input focus-visible:border-input"
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remover TV"
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setPendingDelete(tv)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold " +
                    (online ? "bg-success/12 text-success" : "bg-muted text-muted-foreground")
                  }
                >
                  <span
                    className={
                      online ? "cf-dot-online h-2 w-2" : "h-2 w-2 rounded-full bg-muted-foreground/60"
                    }
                  />
                  {online ? "Online" : "Offline"}
                </span>
                {tv.last_ping ? (
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    ping {new Date(tv.last_ping).toLocaleTimeString("pt-BR")}
                  </span>
                ) : null}
                {tv.screen_resolution ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
                    <MonitorCheck className="h-3 w-3" /> {tv.screen_resolution}
                  </span>
                ) : null}
                {tv.memory_usage ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                    <Cpu className="h-3 w-3" /> {tv.memory_usage}
                  </span>
                ) : null}
                {tv.is_live_active ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-1 text-xs font-bold text-destructive-foreground">
                    <span className="h-2 w-2 rounded-full bg-destructive-foreground" /> AO VIVO
                  </span>
                ) : null}
              </div>

              <div className="mt-4 rounded-xl border border-dashed border-primary/25 bg-secondary/60 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Código de pareamento
                </p>
                <p className="mt-0.5 font-mono text-xl font-extrabold tracking-[0.3em] text-primary">
                  {tv.pairing_code}
                </p>
              </div>

              <div className="mt-4 space-y-1.5">
                <Label>Playlist vinculada</Label>
                <Select
                  value={tv.playlist_id || "none"}
                  onValueChange={(v) =>
                    patchTv(tv.id, { playlist_id: v === "none" ? null : v }, "Playlist vinculada")
                  }
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="Selecionar playlist" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="none">Sem playlist</SelectItem>
                    {playlists.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Layout</Label>
                  <div className="flex gap-1 rounded-xl bg-secondary p-1">
                    {([
                      ["fullscreen", "Tela cheia", Maximize],
                      ["multizone", "Multi-zona", LayoutGrid],
                    ] as const).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => patchTv(tv.id, { layout_mode: value })}
                        className={
                          "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors " +
                          (tv.layout_mode === value
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-primary")
                        }
                      >
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Orientação</Label>
                  <div className="flex gap-1 rounded-xl bg-secondary p-1">
                    {([
                      ["landscape", "16:9"],
                      ["portrait", "9:16"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => patchTv(tv.id, { orientation: value })}
                        className={
                          "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors " +
                          (tv.orientation === value
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-primary")
                        }
                      >
                        <MonitorSmartphone className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {tv.layout_mode === "multizone" ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs" htmlFor={"ticker-" + tv.id}>
                      Texto do rodapé (ticker)
                    </Label>
                    <Input
                      id={"ticker-" + tv.id}
                      defaultValue={tv.ticker_text || ""}
                      placeholder="Ofertas da semana em climatização!"
                      onBlur={(e) => patchTv(tv.id, { ticker_text: e.target.value || null })}
                      className="h-10 rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs" htmlFor={"qr-" + tv.id}>
                      Link do QR code
                    </Label>
                    <Input
                      id={"qr-" + tv.id}
                      defaultValue={tv.qr_url || ""}
                      placeholder="https://instagram.com/centerfrios"
                      onBlur={(e) => patchTv(tv.id, { qr_url: e.target.value || null })}
                      className="h-10 rounded-xl"
                    />
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-3 py-2">
                <Label htmlFor={"event-" + tv.id} className="text-xs font-bold">
                  Exibir mural de eventos
                </Label>
                <Switch
                  id={"event-" + tv.id}
                  checked={tv.event_mode}
                  onCheckedChange={(v) => patchTv(tv.id, { event_mode: v })}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl font-bold"
                  onClick={() => sendCommand(tv, "reload")}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Reiniciar player
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl font-bold"
                  onClick={() => sendCommand(tv, tv.muted ? "unmute" : "mute")}
                >
                  {tv.muted ? (
                    <>
                      <Volume2 className="mr-1.5 h-4 w-4" /> Ativar som
                    </>
                  ) : (
                    <>
                      <VolumeX className="mr-1.5 h-4 w-4" /> Mudo
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl font-bold"
                  onClick={() => sendCommand(tv, "sync")}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" /> Forçar sincronização
                </Button>
              </div>
            </article>
          );
        })}
        {tvs.length === 0 ? (
          <div className="cf-card p-6 text-center sm:col-span-2">
            <Tv className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-semibold">Nenhuma TV registrada</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Abra o player na TV para gerar o código de pareamento.
            </p>
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => (!open ? setPendingDelete(null) : null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              A tela deixará de exibir conteúdo e voltará à tela de pareamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
