import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isOnline, type TvRow } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2, Tv } from "lucide-react";

export function TvManager() {
  const [tvs, setTvs] = useState<TvRow[]>([]);
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from("tvs").select("*").order("created_at", { ascending: true }),
      supabase.from("playlists").select("id, name").order("created_at", { ascending: true }),
    ]);
    setTvs((t || []) as unknown as TvRow[]);
    setPlaylists((p || []) as unknown as { id: string; name: string }[]);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("admin-tvs")
      .on("postgres_changes", { event: "*", schema: "public", table: "tvs" }, () => load())
      .subscribe();
    const interval = setInterval(load, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
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

  async function setPlaylist(tvId: string, playlistId: string) {
    const { error } = await supabase
      .from("tvs")
      .update({ playlist_id: playlistId === "none" ? null : playlistId })
      .eq("id", tvId);
    if (error) {
      toast.error("Falha ao vincular playlist");
      return;
    }
    toast.success("Playlist vinculada");
    load();
  }

  async function rename(tvId: string, value: string) {
    await supabase.from("tvs").update({ name: value }).eq("id", tvId);
  }

  async function remove(tvId: string) {
    if (!window.confirm("Remover esta TV?")) return;
    const { error } = await supabase.from("tvs").delete().eq("id", tvId);
    if (error) {
      toast.error("Não foi possível remover");
      return;
    }
    load();
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-bold">Parear nova TV</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="code">Código</Label>
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg font-bold tracking-widest"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tvname">Nome da TV</Label>
            <Input
              id="tvname"
              placeholder="TV Vitrine — Filial Tabuleiro"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button onClick={pair} disabled={busy} className="font-bold">
            Parear
          </Button>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {tvs.map((tv) => {
          const online = isOnline(tv.last_ping);
          return (
            <Card key={tv.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Tv className="h-4 w-4 shrink-0 text-primary" />
                  <Input
                    defaultValue={tv.name}
                    onBlur={(e) => rename(tv.id, e.target.value)}
                    className="h-8 border-transparent px-1 font-semibold hover:border-input"
                  />
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(tv.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={
                    "rounded-full px-2 py-1 font-bold " +
                    (online
                      ? "bg-success text-success-foreground"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {online ? "Online" : "Offline"}
                </span>
                <span className="rounded-full bg-secondary px-2 py-1 font-semibold text-secondary-foreground">
                  Código {tv.pairing_code}
                </span>
                {tv.is_live_active ? (
                  <span className="rounded-full bg-destructive px-2 py-1 font-bold text-destructive-foreground">
                    AO VIVO
                  </span>
                ) : null}
              </div>

              <div className="mt-3 space-y-1.5">
                <Label>Playlist</Label>
                <Select
                  value={tv.playlist_id || "none"}
                  onValueChange={(v) => setPlaylist(tv.id, v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar playlist" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem playlist</SelectItem>
                    {playlists.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Card>
          );
        })}
        {tvs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma TV registrada. Abra o player na TV para gerar o código.
          </p>
        ) : null}
      </div>
    </div>
  );
}
