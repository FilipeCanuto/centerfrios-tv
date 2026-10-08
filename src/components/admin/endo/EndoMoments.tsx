// Endomarketing — "Disparo de Momentos": cards de acionamento imediato + cadastro/edição/exclusão.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractYoutubeId, type EndoMoment } from "@/lib/centerfrios";
import { youtubeThumb } from "@/lib/endomarketing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Pencil, Plus, Repeat, Sparkles, Trash2, X } from "lucide-react";

type Draft = {
  id?: string;
  title: string;
  description: string;
  youtube_url: string;
  suggested_volume: number;
  loop: boolean;
};
const EMPTY: Draft = {
  title: "",
  description: "",
  youtube_url: "",
  suggested_volume: 80,
  loop: false,
};

export function EndoMoments({
  onPlay,
  disabled,
}: {
  onPlay: (m: EndoMoment) => void;
  disabled?: boolean;
}) {
  const [moments, setMoments] = useState<EndoMoment[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("endomarketing_moments")
      .select("*")
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      toast.error(
        "Não foi possível carregar os momentos (a migration do Endomarketing já foi aplicada?)",
      );
      return;
    }
    setMoments((data || []) as unknown as EndoMoment[]);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("endo-moments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "endomarketing_moments" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  async function save() {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) return toast.error("Dê um nome ao momento");
    if (!extractYoutubeId(draft.youtube_url)) return toast.error("Link do YouTube inválido");
    const row = {
      title,
      description: draft.description.trim() || null,
      youtube_url: draft.youtube_url.trim(),
      suggested_volume: Math.max(0, Math.min(100, Math.round(draft.suggested_volume))),
      loop: draft.loop,
    };
    setSaving(true);
    const { error } = draft.id
      ? await supabase.from("endomarketing_moments").update(row).eq("id", draft.id)
      : await supabase
          .from("endomarketing_moments")
          .insert({ ...row, order_index: moments.length + 1 });
    setSaving(false);
    if (error) return toast.error("Não foi possível salvar o momento");
    toast.success(draft.id ? "Momento atualizado" : "Momento cadastrado");
    setDraft(null);
    load();
  }

  async function remove(m: EndoMoment) {
    if (!window.confirm('Excluir o momento "' + m.title + '"?')) return;
    const { error } = await supabase.from("endomarketing_moments").delete().eq("id", m.id);
    if (error) return toast.error("Não foi possível excluir");
    toast.success("Momento excluído");
    load();
  }

  return (
    <section className="cf-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-extrabold">Disparo de Momentos</h3>
          <p className="text-xs text-muted-foreground">
            Um toque e o momento começa nas TVs selecionadas.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="rounded-xl font-bold"
          onClick={() => setDraft({ ...EMPTY })}
        >
          <Plus className="mr-1 h-4 w-4" /> Novo momento
        </Button>
      </div>

      {draft ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-primary/40 bg-secondary/40 p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="em-title">Título</Label>
            <Input
              id="em-title"
              value={draft.title}
              placeholder="Momento do Abraço"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="em-url">Link do YouTube</Label>
            <Input
              id="em-url"
              value={draft.youtube_url}
              placeholder="https://www.youtube.com/watch?v=..."
              onChange={(e) => setDraft({ ...draft, youtube_url: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="em-desc">Descrição (opcional)</Label>
            <Textarea
              id="em-desc"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="em-vol">Volume sugerido (%)</Label>
              <Input
                id="em-vol"
                type="number"
                min={0}
                max={100}
                value={draft.suggested_volume}
                onChange={(e) =>
                  setDraft({ ...draft, suggested_volume: Number(e.target.value) || 0 })
                }
              />
            </div>
            <label
              htmlFor="em-loop"
              className="flex items-center gap-2 self-end pb-2 text-sm font-bold"
            >
              <Switch
                id="em-loop"
                checked={draft.loop}
                onCheckedChange={(v) => setDraft({ ...draft, loop: v })}
              />
              Repetir (loop)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              <X className="mr-1 h-4 w-4" /> Cancelar
            </Button>
            <Button onClick={save} disabled={saving} className="font-bold">
              Salvar
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {moments.map((m) => {
          const id = extractYoutubeId(m.youtube_url);
          return (
            <div key={m.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <button
                type="button"
                disabled={disabled || !id}
                onClick={() => onPlay(m)}
                className="group relative block aspect-video w-full bg-black text-left disabled:opacity-50"
                aria-label={"Disparar " + m.title}
              >
                {id ? (
                  <img
                    src={youtubeThumb(id)}
                    alt=""
                    className="h-full w-full object-cover opacity-80 group-hover:opacity-100"
                  />
                ) : null}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3">
                  <span className="flex items-center gap-1.5 text-sm font-extrabold text-white">
                    <Sparkles className="h-4 w-4 text-yellow-300" /> {m.title}
                  </span>
                  <span className="text-[11px] font-semibold text-white/80">
                    Volume {m.suggested_volume}%{m.loop ? " · loop" : ""}
                  </span>
                </span>
              </button>
              <div className="flex items-center justify-between gap-2 p-2">
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {m.description || " "}
                </span>
                <span className="flex shrink-0 gap-1">
                  {m.loop ? (
                    <Repeat className="h-4 w-4 text-muted-foreground" aria-label="Loop" />
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label="Editar momento"
                    onClick={() =>
                      setDraft({
                        id: m.id,
                        title: m.title,
                        description: m.description || "",
                        youtube_url: m.youtube_url,
                        suggested_volume: m.suggested_volume,
                        loop: m.loop,
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    aria-label="Excluir momento"
                    onClick={() => remove(m)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            </div>
          );
        })}
        {moments.length === 0 && !draft ? (
          <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
            Nenhum momento cadastrado. Clique em <b>Novo momento</b> (ex.: Momento do Abraço,
            Mensagem do RH, Homenagens).
          </div>
        ) : null}
      </div>
    </section>
  );
}
