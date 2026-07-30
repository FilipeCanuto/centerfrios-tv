import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatBytes, type MediaRow } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { Trash2, Upload, Film, ImageIcon, Timer, HardDrive } from "lucide-react";

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

function readResolution(file: File, isVideo: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (value: string | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    if (isVideo) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => done(v.videoWidth ? v.videoWidth + "x" + v.videoHeight : null);
      v.onerror = () => done(null);
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => done(img.naturalWidth + "x" + img.naturalHeight);
      img.onerror = () => done(null);
      img.src = url;
    }
    setTimeout(() => done(null), 6000);
  });
}

function extOf(title: string) {
  const parts = title.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "—";
}

export function MediaManager({ onChanged }: { onChanged?: () => void }) {
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [duration, setDuration] = useState("10");
  const [pendingDelete, setPendingDelete] = useState<MediaRow | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("media")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Não foi possível carregar as mídias");
      return;
    }
    setMedia((data || []) as unknown as MediaRow[]);
  }

  useEffect(() => {
    load();
  }, []);

  async function uploadWithProgress(file: File, path: string) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", base + "/storage/v1/object/media/" + path, true);
      xhr.setRequestHeader("apikey", anon);
      if (token) xhr.setRequestHeader("authorization", "Bearer " + token);
      xhr.setRequestHeader("x-upsert", "true");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText));
      xhr.onerror = () => reject(new Error("Falha de rede no upload"));
      xhr.send(file);
    });
  }

  async function handleFile(file: File) {
    const isVideo = file.type.indexOf("video") === 0;
    const isImage = file.type.indexOf("image") === 0;
    if (!isVideo && !isImage) {
      toast.error("Envie apenas imagens ou vídeos MP4");
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = Date.now() + "-" + safeName;

    setProgress(0);
    try {
      const resolution = await readResolution(file, isVideo);
      await uploadWithProgress(file, path);
      const { data: signed, error: signErr } = await supabase.storage
        .from("media")
        .createSignedUrl(path, TEN_YEARS);
      if (signErr || !signed) throw signErr || new Error("Falha ao gerar URL");

      const { error } = await supabase.from("media").insert({
        title: file.name,
        url: signed.signedUrl,
        storage_path: path,
        type: isVideo ? "video" : "image",
        duration: isVideo ? 0 : Math.max(3, parseInt(duration, 10) || 10),
        file_size: file.size,
        resolution,
      });
      if (error) throw error;

      toast.success("Mídia enviada");
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha no upload";
      toast.error(message);
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function confirmRemove() {
    const item = pendingDelete;
    setPendingDelete(null);
    if (!item) return;
    if (item.storage_path) await supabase.storage.from("media").remove([item.storage_path]);
    const { error } = await supabase.from("media").delete().eq("id", item.id);
    if (error) {
      toast.error("Não foi possível excluir");
      return;
    }
    toast.success("Mídia excluída");
    load();
    if (onChanged) onChanged();
  }

  return (
    <div className="space-y-5">
      <section className="cf-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <Upload className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">Enviar mídia</h3>
            <p className="text-xs text-muted-foreground">
              Imagens e vídeos MP4 até 4K. O envio é otimizado para exibição em TV.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="dur">Tempo padrão das imagens (segundos)</Label>
            <Input
              id="dur"
              type="number"
              min={3}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="h-11 max-w-[160px] rounded-xl"
            />
          </div>
          <div>
            <input
              ref={inputRef}
              id="file"
              type="file"
              accept="image/*,video/mp4,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) handleFile(f);
              }}
            />
            <Button
              className="h-11 w-full rounded-xl px-6 font-bold sm:w-auto"
              onClick={() => inputRef.current && inputRef.current.click()}
              disabled={progress !== null}
            >
              <Upload className="mr-2 h-4 w-4" />
              Selecionar arquivo
            </Button>
          </div>
        </div>

        {progress !== null ? (
          <div className="mt-4">
            <Progress value={progress} className="h-2" />
            <p className="mt-1.5 text-xs font-semibold text-muted-foreground">
              Enviando… {progress}%
            </p>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {media.map((m) => (
          <article key={m.id} className="cf-card group overflow-hidden p-0">
            <div className="relative flex aspect-video items-center justify-center bg-foreground/90">
              {m.type === "image" ? (
                <img src={m.url} alt={m.title} className="h-full w-full object-contain" />
              ) : (
                <video src={m.url} muted className="h-full w-full object-contain" />
              )}
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                {m.type === "video" ? (
                  <Film className="h-3 w-3" />
                ) : (
                  <ImageIcon className="h-3 w-3" />
                )}
                {m.type === "video" ? "Vídeo" : "Imagem"}
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Excluir mídia"
                onClick={() => setPendingDelete(m)}
                className="absolute right-2 top-2 h-8 w-8 rounded-lg bg-card/85 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-3.5">
              <p className="truncate text-sm font-bold">{m.title}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                  {extOf(m.title)}
                </span>
                {m.resolution ? (
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                    {m.resolution}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                  <HardDrive className="h-3 w-3" />
                  {formatBytes(m.file_size)}
                </span>
                {m.type === "image" ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-accent-foreground">
                    <Timer className="h-3 w-3" />
                    {m.duration}s
                  </span>
                ) : null}
              </div>
            </div>
          </article>
        ))}
        {media.length === 0 ? (
          <div className="cf-card p-6 text-center sm:col-span-2 lg:col-span-3">
            <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-semibold">Nenhuma mídia enviada ainda</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Envie imagens ou vídeos para montar suas playlists.
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
            <AlertDialogTitle>Excluir “{pendingDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo será removido do armazenamento e das playlists que o utilizam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
