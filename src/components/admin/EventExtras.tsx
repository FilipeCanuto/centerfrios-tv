import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EventSponsor } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Handshake, Timer, PartyPopper, Trash2, Upload } from "lucide-react";

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

async function updateAllTvs(changes: Record<string, unknown>) {
  const { error } = await supabase
    .from("tvs")
    .update(changes as never)
    .not("id", "is", null);
  return error;
}

export function EventExtras() {
  const [sponsors, setSponsors] = useState<EventSponsor[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState("15");
  const [countLabel, setCountLabel] = useState("O Workshop começa em");
  const [welcome, setWelcome] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("event_sponsors")
      .select("*")
      .order("sort_order", { ascending: true });
    setSponsors((data || []) as unknown as EventSponsor[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addSponsor(file: File) {
    if (!name.trim()) {
      toast.error("Informe o nome do patrocinador");
      return;
    }
    setBusy(true);
    const path = "sponsors/" + Date.now() + "-" + file.name.replace(/[^\w.-]/g, "_");
    const up = await supabase.storage.from("event-photos").upload(path, file, { upsert: true });
    if (up.error) {
      setBusy(false);
      toast.error("Falha ao enviar o logo");
      return;
    }
    const { data: signed } = await supabase.storage
      .from("event-photos")
      .createSignedUrl(path, TEN_YEARS);
    const { error } = await supabase.from("event_sponsors").insert({
      name: name.trim(),
      image_url: signed?.signedUrl || "",
      storage_path: path,
      sort_order: sponsors.length,
    });
    setBusy(false);
    if (error) {
      toast.error("Não foi possível cadastrar o patrocinador");
      return;
    }
    setName("");
    toast.success("Patrocinador adicionado à régua");
    load();
  }

  async function toggleSponsor(s: EventSponsor, active: boolean) {
    await supabase.from("event_sponsors").update({ active }).eq("id", s.id);
    load();
  }

  async function removeSponsor(s: EventSponsor) {
    if (s.storage_path) await supabase.storage.from("event-photos").remove([s.storage_path]);
    await supabase.from("event_sponsors").delete().eq("id", s.id);
    load();
  }

  async function startCountdown() {
    const mins = Math.max(1, parseInt(minutes, 10) || 1);
    const endsAt = new Date(Date.now() + mins * 60000).toISOString();
    const error = await updateAllTvs({
      countdown_label: countLabel.trim() || "Começa em",
      countdown_ends_at: endsAt,
    });
    if (error) {
      toast.error("Não foi possível iniciar o cronômetro");
      return;
    }
    toast.success("Cronômetro de " + mins + " min no ar");
  }

  async function stopCountdown() {
    await updateAllTvs({ countdown_ends_at: null });
    toast.success("Cronômetro encerrado");
  }

  async function fireWelcome() {
    if (!welcome.trim()) {
      toast.error("Escreva a mensagem de boas-vindas");
      return;
    }
    const error = await updateAllTvs({
      welcome_message: welcome.trim(),
      welcome_until: new Date(Date.now() + 15000).toISOString(),
    });
    if (error) {
      toast.error("Não foi possível disparar a vinheta");
      return;
    }
    toast.success("Vinheta exibida por 15 segundos");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="cf-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <Handshake className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">Régua de patrocinadores</h3>
            <p className="text-xs text-muted-foreground">
              Logos em carrossel nas TVs com a régua ativada.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            placeholder="Nome do parceiro"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 rounded-xl"
          />
          <Button asChild disabled={busy} className="h-11 rounded-xl font-bold">
            <label className="cursor-pointer">
              <Upload className="mr-1.5 h-4 w-4" /> Enviar logo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (f) addSponsor(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {sponsors.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-2.5"
            >
              <img src={s.image_url} alt={s.name} className="h-9 w-16 rounded object-contain" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{s.name}</span>
              <Switch checked={s.active} onCheckedChange={(v) => toggleSponsor(s, v)} />
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remover patrocinador"
                className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => removeSponsor(s)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {sponsors.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Nenhum patrocinador cadastrado.
            </p>
          ) : null}
        </div>
      </section>

      <div className="space-y-4">
        <section className="cf-card p-5">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
              <Timer className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-extrabold">Cronômetro regressivo</h3>
              <p className="text-xs text-muted-foreground">Aparece no topo de todas as telas.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_110px]">
            <div className="space-y-1.5">
              <Label className="text-xs">Título</Label>
              <Input
                value={countLabel}
                onChange={(e) => setCountLabel(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Minutos</Label>
              <Input
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
                className="h-11 rounded-xl text-center font-extrabold"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={startCountdown} className="h-10 flex-1 rounded-xl font-bold">
              Iniciar contagem
            </Button>
            <Button onClick={stopCountdown} variant="outline" className="h-10 rounded-xl font-bold">
              Encerrar
            </Button>
          </div>
        </section>

        <section className="cf-card p-5">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
              <PartyPopper className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-extrabold">Vinheta de boas-vindas</h3>
              <p className="text-xs text-muted-foreground">
                Tela cheia por 15 segundos em todas as TVs.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              placeholder="Bem-vindo, Eng. Ricardo Alves!"
              value={welcome}
              onChange={(e) => setWelcome(e.target.value)}
              className="h-11 rounded-xl"
            />
            <Button onClick={fireWelcome} className="h-11 rounded-xl px-6 font-bold">
              Exibir agora
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
