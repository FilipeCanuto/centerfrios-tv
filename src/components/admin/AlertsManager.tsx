import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AlertTemplate } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BellRing, Megaphone, Plus, Trash2, Zap } from "lucide-react";

const QUICK: { label: string; message: string; seconds: number }[] = [
  { label: "Sorteio", message: "🎉 Sorteio em 5 minutos! Venha participar.", seconds: 30 },
  { label: "Oferta relâmpago", message: "⚡ Oferta relâmpago no Açougue — só agora!", seconds: 45 },
  { label: "Atendimento", message: "Atendimento preferencial disponível no balcão 2.", seconds: 20 },
];

export function AlertsManager() {
  const [templates, setTemplates] = useState<AlertTemplate[]>([]);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [lastFired, setLastFired] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("alert_templates")
      .select("id,message,duration_seconds,created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Não foi possível carregar os avisos");
      return;
    }
    setTemplates((data || []) as unknown as AlertTemplate[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function broadcast(text: string, duration: number) {
    const clean = text.trim();
    if (!clean) {
      toast.error("Escreva a mensagem do aviso");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("tv_alerts").insert({
      message: clean,
      expires_at: new Date(Date.now() + Math.max(5, duration) * 1000).toISOString(),
    });
    setBusy(false);
    if (error) {
      toast.error("Não foi possível exibir o aviso nas TVs");
      return;
    }
    setLastFired(clean);
    toast.success("Aviso no ar em todas as TVs");
  }

  async function saveTemplate() {
    const clean = message.trim();
    if (!clean) {
      toast.error("Escreva a mensagem do aviso");
      return;
    }
    const { error } = await supabase
      .from("alert_templates")
      .insert({ message: clean, duration_seconds: Math.max(5, seconds) });
    if (error) {
      toast.error("Não foi possível salvar o aviso");
      return;
    }
    setMessage("");
    toast.success("Aviso salvo na biblioteca");
    load();
  }

  async function removeTemplate(id: string) {
    const { error } = await supabase.from("alert_templates").delete().eq("id", id);
    if (error) {
      toast.error("Não foi possível excluir");
      return;
    }
    load();
  }

  return (
    <div className="space-y-5">
      <section className="cf-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
            <Megaphone className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">Novo aviso de impacto</h3>
            <p className="text-xs text-muted-foreground">
              Aparece imediatamente como banner sobreposto em todas as telas.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_130px]">
          <div className="space-y-1.5">
            <Label htmlFor="alert-msg">Mensagem</Label>
            <Input
              id="alert-msg"
              value={message}
              maxLength={140}
              placeholder="Sorteio em 5 minutos!"
              onChange={(e) => setMessage(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-sec">Duração (seg)</Label>
            <Input
              id="alert-sec"
              type="number"
              min={5}
              max={300}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value) || 30)}
              className="h-11 rounded-xl"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() => broadcast(message, seconds)}
            disabled={busy}
            variant="destructive"
            className="cf-live-glow h-11 rounded-xl px-6 font-extrabold"
          >
            <Zap className="mr-1.5 h-4 w-4" /> Exibir agora nas TVs
          </Button>
          <Button
            onClick={saveTemplate}
            variant="outline"
            className="h-11 rounded-xl font-bold"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Salvar aviso
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => {
                setMessage(q.message);
                setSeconds(q.seconds);
              }}
              className="rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-bold text-secondary-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {q.label}
            </button>
          ))}
        </div>

        {lastFired ? (
          <p className="mt-3 text-xs font-semibold text-muted-foreground">
            Último aviso exibido: “{lastFired}”
          </p>
        ) : null}
      </section>

      <div className="px-1">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted-foreground">
          Biblioteca de avisos
        </h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <article key={t.id} className="cf-card flex items-center gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/20 text-primary">
              <BellRing className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{t.message}</p>
              <p className="text-xs text-muted-foreground">{t.duration_seconds} segundos na tela</p>
            </div>
            <Button
              size="sm"
              className="h-9 shrink-0 rounded-xl font-bold"
              onClick={() => broadcast(t.message, t.duration_seconds)}
              disabled={busy}
            >
              Exibir
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Excluir aviso"
              className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => removeTemplate(t.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </article>
        ))}
        {templates.length === 0 ? (
          <div className="cf-card p-6 text-center sm:col-span-2">
            <Megaphone className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-semibold">Nenhum aviso salvo</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Guarde comunicados frequentes para disparar com um toque.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
