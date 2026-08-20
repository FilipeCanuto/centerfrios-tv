import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EventCheckin, TvRow } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Download, QrCode, RefreshCw, Tv, Users } from "lucide-react";

const POSITIONS = [
  { value: "top-left", label: "Superior esquerdo" },
  { value: "top-right", label: "Superior direito" },
  { value: "bottom-left", label: "Inferior esquerdo" },
  { value: "bottom-right", label: "Inferior direito" },
];

function csvCell(value: string): string {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

export function PresenceManager() {
  const [tvs, setTvs] = useState<TvRow[]>([]);
  const [checkins, setCheckins] = useState<EventCheckin[]>([]);
  const [loading, setLoading] = useState(false);
  const [formUrl, setFormUrl] = useState("/presenca");

  useEffect(() => {
    setFormUrl(window.location.origin + "/presenca");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: t }, { data: c, error }] = await Promise.all([
      supabase.from("tvs").select("*").order("created_at", { ascending: true }),
      supabase
        .from("event_checkins")
        .select("id,full_name,phone,company,created_at")
        .order("created_at", { ascending: false }),
    ]);
    setLoading(false);
    if (error) {
      toast.error("Não foi possível carregar os inscritos");
      return;
    }
    setTvs((t || []) as unknown as TvRow[]);
    setCheckins((c || []) as unknown as EventCheckin[]);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("presence-checkins")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "event_checkins" },
        (payload) => {
          setCheckins((prev) => [payload.new as unknown as EventCheckin, ...prev]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function patchTv(id: string, patch: Record<string, unknown>) {
    setTvs((prev) => prev.map((t) => (t.id === id ? ({ ...t, ...patch } as TvRow) : t)));
    const { error } = await supabase.from("tvs").update(patch).eq("id", id);
    if (error) {
      toast.error("Não foi possível salvar");
      load();
      return;
    }
    toast.success("Configuração enviada para a TV");
  }

  async function applyAll(patch: Record<string, unknown>) {
    if (!tvs.length) return;
    setTvs((prev) => prev.map((t) => ({ ...t, ...patch }) as TvRow));
    const { error } = await supabase
      .from("tvs")
      .update(patch)
      .in(
        "id",
        tvs.map((t) => t.id),
      );
    if (error) {
      toast.error("Não foi possível aplicar em todas as TVs");
      load();
      return;
    }
    toast.success("Aplicado em todas as TVs");
  }

  function exportCsv() {
    const header = ["Nome", "Telefone", "Estabelecimento", "Data"];
    const rows = checkins.map((c) => [
      c.full_name,
      c.phone,
      c.company,
      new Date(c.created_at).toLocaleString("pt-BR"),
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "presencas-centerfrios.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-extrabold">
            <QrCode className="h-5 w-5 text-primary" /> QR Code de Presença
          </h2>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => applyAll({ show_presence_qr: true })}>
              Ligar em todas
            </Button>
            <Button size="sm" variant="ghost" onClick={() => applyAll({ show_presence_qr: false })}>
              Desligar todas
            </Button>
          </div>
        </div>
        <p className="mt-1 break-all text-xs text-muted-foreground">
          Formulário: {formUrl}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {tvs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma TV cadastrada ainda.</p>
          ) : null}
          {tvs.map((tv) => (
            <div key={tv.id} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Tv className="h-4 w-4 text-primary" /> {tv.name}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <Label htmlFor={"pqr-" + tv.id} className="text-xs font-bold">
                  Exibir QR Code de Presença na TV
                </Label>
                <Switch
                  id={"pqr-" + tv.id}
                  checked={!!tv.show_presence_qr}
                  onCheckedChange={(v) => patchTv(tv.id, { show_presence_qr: v })}
                />
              </div>
              <div className="mt-2 space-y-1.5">
                <Label className="text-xs">Posição do QR Code</Label>
                <Select
                  value={tv.presence_qr_position || "bottom-right"}
                  onValueChange={(v) => patchTv(tv.id, { presence_qr_position: v })}
                >
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {POSITIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-extrabold">
            <Users className="h-5 w-5 text-primary" /> Inscritos
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-extrabold text-accent-foreground">
              {checkins.length}
            </span>
          </h2>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw className="mr-1.5 h-4 w-4" /> Atualizar
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={!checkins.length}>
              <Download className="mr-1.5 h-4 w-4" /> Exportar CSV
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3 font-bold">Nome</th>
                <th className="py-2 pr-3 font-bold">Telefone</th>
                <th className="py-2 pr-3 font-bold">Estabelecimento</th>
                <th className="py-2 font-bold">Horário</th>
              </tr>
            </thead>
            <tbody>
              {checkins.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    Nenhuma presença confirmada ainda.
                  </td>
                </tr>
              ) : null}
              {checkins.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-semibold">{c.full_name}</td>
                  <td className="py-2 pr-3">{c.phone}</td>
                  <td className="py-2 pr-3">{c.company}</td>
                  <td className="py-2 text-muted-foreground">
                    {new Date(c.created_at).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
