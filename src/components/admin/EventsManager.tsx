import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EventPhoto } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Check, Sparkles, Trash2, X, Images, QrCode } from "lucide-react";

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

type PhotoView = EventPhoto & { preview: string };

export function EventsManager({ onChanged }: { onChanged?: () => void }) {
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [moderation, setModeration] = useState(true);
  const [submitUrl, setSubmitUrl] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("event_photos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(120);
    if (error) {
      toast.error("Não foi possível carregar as fotos");
      return;
    }
    const rows = (data || []) as unknown as (EventPhoto & { storage_path: string | null })[];
    const withPreview: PhotoView[] = [];
    for (const row of rows) {
      let preview = row.image_url;
      if (!preview && row.storage_path) {
        const { data: signed } = await supabase.storage
          .from("event-photos")
          .createSignedUrl(row.storage_path, 3600);
        preview = signed?.signedUrl || "";
      }
      withPreview.push({ ...row, preview });
    }
    setPhotos(withPreview);
    if (onChanged) onChanged();
  }, [onChanged]);

  useEffect(() => {
    setSubmitUrl(window.location.origin + "/enviar");
    load();
    const channel = supabase
      .channel("admin-event-photos")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_photos" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("auto_publish")
      .eq("id", "global")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setModeration(!(data as { auto_publish: boolean }).auto_publish);
      });
  }, []);

  async function approve(photo: PhotoView) {
    let url = photo.image_url;
    if (!url && photo.storage_path) {
      const { data: signed, error } = await supabase.storage
        .from("event-photos")
        .createSignedUrl(photo.storage_path, TEN_YEARS);
      if (error || !signed) {
        toast.error("Falha ao liberar a imagem");
        return;
      }
      url = signed.signedUrl;
    }
    const { error } = await supabase
      .from("event_photos")
      .update({ status: "approved", image_url: url })
      .eq("id", photo.id);
    if (error) {
      toast.error("Não foi possível aprovar");
      return;
    }
    toast.success("Foto aprovada — já entra no loop das TVs");
    load();
  }

  async function reject(photo: PhotoView) {
    const { error } = await supabase
      .from("event_photos")
      .update({ status: "rejected", featured: false })
      .eq("id", photo.id);
    if (error) {
      toast.error("Não foi possível rejeitar");
      return;
    }
    load();
  }

  async function feature(photo: PhotoView) {
    if (photo.status !== "approved") await approve(photo);
    await supabase.from("event_photos").update({ featured: false }).eq("featured", true);
    const { error } = await supabase
      .from("event_photos")
      .update({ featured: true, status: "approved" })
      .eq("id", photo.id);
    if (error) {
      toast.error("Não foi possível destacar");
      return;
    }
    toast.success("Foto em destaque nas TVs");
    load();
  }

  async function clearFeatured() {
    await supabase.from("event_photos").update({ featured: false }).eq("featured", true);
    toast.success("Destaque encerrado");
    load();
  }

  async function removePhoto(photo: PhotoView) {
    if (photo.storage_path) await supabase.storage.from("event-photos").remove([photo.storage_path]);
    await supabase.from("event_photos").delete().eq("id", photo.id);
    load();
  }

  async function setModerationMode(value: boolean) {
    setModeration(value);
    const { error: settingsError } = await supabase
      .from("app_settings")
      .update({ auto_publish: !value })
      .eq("id", "global");
    if (settingsError) {
      toast.error("Não foi possível salvar a preferência");
      setModeration(!value);
      return;
    }
    if (!value) {
      const { error } = await supabase
        .from("event_photos")
        .update({ status: "approved" })
        .eq("status", "pending");
      if (error) toast.error("Falha ao liberar as fotos pendentes");
      else toast.success("Envio direto ativado — fotos pendentes liberadas");
      load();
    } else {
      toast.success("Moderação manual ativada");
    }
  }

  const pending = photos.filter((p) => p.status === "pending");
  const approved = photos.filter((p) => p.status === "approved");

  return (
    <div className="space-y-5">
      <section className="cf-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3">
            <div className="min-w-0">
              <Label htmlFor="moderation" className="text-sm font-extrabold">
                Modo de moderação
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {moderation
                  ? "Cada foto exige aprovação manual no seu iPhone."
                  : "Publicação automática: fotos vão direto para as TVs."}
              </p>
            </div>
            <Switch id="moderation" checked={moderation} onCheckedChange={setModerationMode} />
          </div>

          <div className="rounded-xl border border-dashed border-primary/30 bg-secondary/40 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-extrabold">
              <QrCode className="h-4 w-4 text-primary" /> Link para os clientes
            </p>
            <p className="mt-1 break-all font-mono text-xs text-primary">{submitUrl}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Use este endereço no QR code das TVs em modo multi-zona.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted-foreground">
          Mural do evento
        </h3>
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span>{pending.length} pendentes</span>
          <span>·</span>
          <span>{approved.length} aprovadas</span>
          <Button size="sm" variant="ghost" className="rounded-lg" onClick={clearFeatured}>
            Encerrar destaque
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {photos.map((p) => (
          <article key={p.id} className="cf-card overflow-hidden p-0">
            <div className="relative aspect-square bg-foreground/90">
              {p.preview ? (
                <img src={p.preview} alt="Foto enviada" className="h-full w-full object-cover" />
              ) : null}
              <span
                className={
                  "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold " +
                  (p.status === "approved"
                    ? "bg-success text-success-foreground"
                    : p.status === "rejected"
                      ? "bg-muted text-muted-foreground"
                      : "bg-accent text-accent-foreground")
                }
              >
                {p.status === "approved"
                  ? "Aprovada"
                  : p.status === "rejected"
                    ? "Rejeitada"
                    : "Pendente"}
              </span>
              {p.featured ? (
                <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                  <Sparkles className="h-3 w-3" /> Destaque
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1 p-2.5">
              <Button
                size="sm"
                className="h-8 flex-1 rounded-lg font-bold"
                onClick={() => approve(p)}
                disabled={p.status === "approved"}
              >
                <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                aria-label="Rejeitar"
                onClick={() => reject(p)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                aria-label="Exibir agora em destaque"
                onClick={() => feature(p)}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Excluir foto"
                onClick={() => removePhoto(p)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </article>
        ))}
        {photos.length === 0 ? (
          <div className="cf-card p-6 text-center sm:col-span-2 lg:col-span-4">
            <Images className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-semibold">Nenhuma foto recebida ainda</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Compartilhe o link do mural com os clientes do evento.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
