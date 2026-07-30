import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatBytes, type MediaRow } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, Upload, Film, ImageIcon } from "lucide-react";

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

export function MediaManager({ onChanged }: { onChanged?: () => void }) {
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [duration, setDuration] = useState("10");
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

  async function remove(item: MediaRow) {
    if (!window.confirm("Excluir a mídia \"" + item.title + "\"?")) return;
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
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="dur">Tempo padrão das imagens (segundos)</Label>
            <Input
              id="dur"
              type="number"
              min={3}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="max-w-[160px]"
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
              className="w-full font-bold sm:w-auto"
              onClick={() => inputRef.current && inputRef.current.click()}
              disabled={progress !== null}
            >
              <Upload className="mr-2 h-4 w-4" />
              Enviar mídia
            </Button>
          </div>
        </div>
        {progress !== null ? (
          <div className="mt-4">
            <Progress value={progress} />
            <p className="mt-1 text-xs text-muted-foreground">Enviando… {progress}%</p>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {media.map((m) => (
          <Card key={m.id} className="overflow-hidden p-0">
            <div className="flex aspect-video items-center justify-center bg-muted">
              {m.type === "image" ? (
                <img src={m.url} alt={m.title} className="h-full w-full object-cover" />
              ) : (
                <video src={m.url} muted className="h-full w-full object-cover" />
              )}
            </div>
            <div className="flex items-start justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{m.title}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  {m.type === "video" ? (
                    <Film className="h-3 w-3" />
                  ) : (
                    <ImageIcon className="h-3 w-3" />
                  )}
                  {m.type === "video" ? "Vídeo" : m.duration + "s"} · {formatBytes(m.file_size)}
                </p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove(m)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </Card>
        ))}
        {media.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mídia enviada ainda.</p>
        ) : null}
      </div>
    </div>
  );
}
