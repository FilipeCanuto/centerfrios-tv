import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Trash2,
  Upload,
  Film,
  ImageIcon,
  Timer,
  HardDrive,
  Search,
  CheckCircle2,
  XCircle,
  RotateCcw,
  QrCode,
  Youtube,
  ListVideo,
} from "lucide-react";

/* Aceita watch?v=, youtu.be/, shorts/, embed/ ou o próprio ID de 11 caracteres */
export function parseYoutubeId(value: string): string {
  const v = (value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  const m = v.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : "";
}

/* Playlist: youtube.com/playlist?list=... ou watch?v=...&list=... (ignora a lista "Watch Later" -> WL) */
export function parseYoutubePlaylistId(value: string): string {
  const v = (value || "").trim();
  const m = v.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (!m) return "";
  return m[1] === "WL" ? "" : m[1];
}

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

type QueueStatus = "queued" | "uploading" | "done" | "error";

type QueueItem = {
  id: string;
  file: File;
  preview: string;
  isVideo: boolean;
  progress: number;
  status: QueueStatus;
  message?: string;
};

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
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [duration, setDuration] = useState("10");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "video" | "image">("all");
  const [pendingDelete, setPendingDelete] = useState<MediaRow | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const runningRef = useRef(false);
  const [ytUrl, setYtUrl] = useState("");
  const [ytTitle, setYtTitle] = useState("");
  const [ytSaving, setYtSaving] = useState(false);
  const [ytImporting, setYtImporting] = useState(false);
  const ytId = parseYoutubeId(ytUrl);
  const ytPlaylistId = parseYoutubePlaylistId(ytUrl);

  async function importYoutubePlaylist() {
    const playlistId = ytPlaylistId;
    if (!playlistId) return;
    setYtImporting(true);
    try {
      type PlaylistApiItem = {
        snippet?: { title?: string; resourceId?: { videoId?: string } };
      };
      let data: { items?: PlaylistApiItem[]; error?: string } | null = null;
      try {
        const res = await fetch(
          "/api/public/youtube-playlist?playlistId=" + encodeURIComponent(playlistId),
        );
        data = await res.json();
      } catch {
        toast.error("Falha de rede ao consultar a playlist");
        return;
      }

      if (!data || data.error) {
        toast.error(data?.error || "Não foi possível importar a playlist");
        return;
      }

      const rawItems = data.items || [];
      const items = rawItems
        .map((it) => ({
          videoId: it.snippet?.resourceId?.videoId || "",
          title: it.snippet?.title || "",
        }))
        // pula vídeos privados/removidos da playlist
        .filter(
          (it) =>
            it.videoId && it.title && it.title !== "Private video" && it.title !== "Deleted video",
        );

      if (!items.length) {
        toast.error("Playlist vazia ou privada");
        return;
      }

      const existingUrls = new Set(media.map((m) => m.url));
      const rows = items
        .map((it) => ({
          title: it.title,
          url: "https://www.youtube.com/watch?v=" + it.videoId,
          type: "youtube",
          duration: 0,
          resolution: null as string | null,
        }))
        .filter((row) => !existingUrls.has(row.url));

      if (!rows.length) {
        toast.success("Todos os vídeos dessa playlist já estavam na galeria");
        setYtUrl("");
        return;
      }

      const { error: insertError } = await supabase.from("media").insert(rows);
      if (insertError) {
        toast.error("Falha ao salvar os vídeos importados");
        return;
      }

      const skipped = items.length - rows.length;
      toast.success(
        "Playlist importada: " +
          rows.length +
          " vídeo" +
          (rows.length === 1 ? "" : "s") +
          (skipped ? " (" + skipped + " já existia" + (skipped === 1 ? "" : "m") + " na galeria)" : ""),
      );
      setYtUrl("");
      load();
      if (onChanged) onChanged();
    } finally {
      setYtImporting(false);
    }
  }

  async function addYoutube() {
    const id = parseYoutubeId(ytUrl);
    if (!id) {
      toast.error("Link do YouTube inválido");
      return;
    }
    setYtSaving(true);
    const { error } = await supabase.from("media").insert({
      title: ytTitle.trim() || "Vídeo do YouTube",
      url: "https://www.youtube.com/watch?v=" + id,
      type: "youtube",
      duration: 0,
      resolution: null,
    });
    setYtSaving(false);
    if (error) {
      toast.error("Não foi possível adicionar o vídeo");
      return;
    }
    toast.success("Vídeo do YouTube adicionado");
    setYtUrl("");
    setYtTitle("");
    load();
    if (onChanged) onChanged();
  }

  async function saveQr(m: MediaRow, value: string) {
    const next = value.trim() || null;
    if ((m.qr_url || null) === next) return;
    const { error } = await supabase.from("media").update({ qr_url: next }).eq("id", m.id);
    if (error) {
      toast.error("Não foi possível salvar o QR code");
      return;
    }
    toast.success(next ? "QR code vinculado à mídia" : "QR code removido");
    load();
  }

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

  function patch(id: string, changes: Partial<QueueItem>) {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...changes } : q)));
  }

  async function uploadWithProgress(item: QueueItem, path: string) {
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
        if (e.lengthComputable) patch(item.id, { progress: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText));
      xhr.onerror = () => reject(new Error("Falha de rede no upload"));
      xhr.send(item.file);
    });
  }

  async function processOne(item: QueueItem) {
    patch(item.id, { status: "uploading", progress: 0, message: undefined });
    const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = Date.now() + "-" + Math.random().toString(36).slice(2, 7) + "-" + safeName;
    try {
      const resolution = await readResolution(item.file, item.isVideo);
      await uploadWithProgress(item, path);
      const { data: signed, error: signErr } = await supabase.storage
        .from("media")
        .createSignedUrl(path, TEN_YEARS);
      if (signErr || !signed) throw signErr || new Error("Falha ao gerar URL");

      const { error } = await supabase.from("media").insert({
        title: item.file.name,
        url: signed.signedUrl,
        storage_path: path,
        type: item.isVideo ? "video" : "image",
        duration: item.isVideo ? 0 : Math.max(3, parseInt(duration, 10) || 10),
        file_size: item.file.size,
        resolution,
      });
      if (error) throw error;
      patch(item.id, { status: "done", progress: 100 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha no upload";
      patch(item.id, { status: "error", message });
    }
  }

  async function runQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      // processa sequencialmente para não saturar a rede da loja
      for (;;) {
        const next = await new Promise<QueueItem | null>((resolve) => {
          setQueue((prev) => {
            resolve(prev.find((q) => q.status === "queued") || null);
            return prev;
          });
        });
        if (!next) break;
        await processOne(next);
      }
      await load();
      if (onChanged) onChanged();
    } finally {
      runningRef.current = false;
    }
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const accepted: QueueItem[] = [];
    Array.from(files).forEach((file) => {
      const isVideo = file.type.indexOf("video") === 0;
      const isImage = file.type.indexOf("image") === 0;
      if (!isVideo && !isImage) return;
      accepted.push({
        id: Math.random().toString(36).slice(2),
        file,
        preview: URL.createObjectURL(file),
        isVideo,
        progress: 0,
        status: "queued",
      });
    });
    if (accepted.length === 0) {
      toast.error("Envie apenas imagens ou vídeos");
      return;
    }
    setQueue((prev) => prev.concat(accepted));
    if (inputRef.current) inputRef.current.value = "";
    setTimeout(runQueue, 0);
  }

  function retry(id: string) {
    patch(id, { status: "queued", progress: 0, message: undefined });
    setTimeout(runQueue, 0);
  }

  function clearFinished() {
    setQueue((prev) => {
      prev.forEach((q) => {
        if (q.status === "done") URL.revokeObjectURL(q.preview);
      });
      return prev.filter((q) => q.status !== "done");
    });
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

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return media.filter((m) => {
      if (filter !== "all" && m.type !== filter) return false;
      if (term && m.title.toLowerCase().indexOf(term) === -1) return false;
      return true;
    });
  }, [media, search, filter]);

  const activeUploads = queue.filter((q) => q.status === "uploading" || q.status === "queued").length;

  return (
    <div className="space-y-5">
      <section className="cf-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <Upload className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">Enviar mídias em massa</h3>
            <p className="text-xs text-muted-foreground">
              Selecione vários arquivos de uma vez — imagens e vídeos MP4 até 4K.
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground">
              Recomendamos .MP4 H.264 para reprodução fluida 4K
            </p>
            <p className="text-[11px] font-semibold text-muted-foreground">
              Vídeo do Instagram/Reels? Salve o vídeo pelo próprio app e envie aqui — fica em tela
              cheia, sem marca d'água nem travas, igual aos outros vídeos.
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
              multiple
              accept="video/mp4,image/*,video/quicktime,video/*"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button
              className="h-11 w-full rounded-xl px-6 font-bold sm:w-auto"
              onClick={() => inputRef.current && inputRef.current.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Selecionar arquivos
            </Button>
          </div>
        </div>

        {queue.length ? (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
                Fila de envio · {activeUploads} pendente{activeUploads === 1 ? "" : "s"}
              </p>
              <Button size="sm" variant="ghost" className="rounded-lg" onClick={clearFinished}>
                Limpar concluídos
              </Button>
            </div>
            <ul className="space-y-2">
              {queue.map((q) => (
                <li
                  key={q.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-2"
                >
                  <span className="h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-foreground/90">
                    {q.isVideo ? (
                      <video src={q.preview} muted className="h-full w-full object-contain" />
                    ) : (
                      <img src={q.preview} alt="" className="h-full w-full object-contain" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{q.file.name}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Progress value={q.status === "done" ? 100 : q.progress} className="h-1.5" />
                      <span className="shrink-0 text-[11px] font-bold text-muted-foreground">
                        {formatBytes(q.file.size)}
                      </span>
                    </div>
                    {q.message ? (
                      <p className="mt-1 truncate text-[11px] font-semibold text-destructive">
                        {q.message}
                      </p>
                    ) : null}
                  </div>
                  {q.status === "done" ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                  ) : q.status === "error" ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Tentar novamente"
                      className="h-8 w-8 shrink-0 rounded-lg text-destructive"
                      onClick={() => retry(q.id)}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  ) : q.status === "uploading" ? (
                    <span className="shrink-0 text-xs font-extrabold text-primary">
                      {q.progress}%
                    </span>
                  ) : (
                    <XCircle className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="cf-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <Youtube className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">Adicionar vídeo do YouTube</h3>
            <p className="text-xs text-muted-foreground">
              Cole o link (watch, youtu.be, shorts) ou o link de uma playlist inteira
              (youtube.com/playlist?list=... ou watch?v=...&list=...).
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="yt-url">Link do YouTube</Label>
            <Input
              id="yt-url"
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=... ou .../playlist?list=..."
              className="h-11 rounded-xl"
            />
          </div>
          {ytPlaylistId ? (
            <div className="space-y-1.5 sm:col-span-2">
              <p className="text-xs font-semibold text-muted-foreground">
                Link de playlist detectado — cada vídeo entra como um item separado na galeria.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="yt-title">Nome da mídia</Label>
              <Input
                id="yt-title"
                value={ytTitle}
                onChange={(e) => setYtTitle(e.target.value)}
                placeholder="Ex.: Campanha de verão"
                className="h-11 rounded-xl"
              />
            </div>
          )}
          {ytPlaylistId ? (
            <Button
              className="h-11 rounded-xl px-6 font-bold"
              disabled={ytImporting}
              onClick={importYoutubePlaylist}
            >
              <ListVideo className="mr-2 h-4 w-4" />
              {ytImporting ? "Importando…" : "Importar playlist"}
            </Button>
          ) : (
            <Button
              className="h-11 rounded-xl px-6 font-bold"
              disabled={!ytId || ytSaving}
              onClick={addYoutube}
            >
              Adicionar
            </Button>
          )}
        </div>

        {ytUrl.trim() && !ytId && !ytPlaylistId ? (
          <p className="mt-2 text-xs font-semibold text-destructive">
            Link inválido — use watch?v=, youtu.be/, shorts/ ou um link de playlist.
          </p>
        ) : null}

        {ytId && !ytPlaylistId ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-2">
            <img
              src={"https://i.ytimg.com/vi/" + ytId + "/mqdefault.jpg"}
              alt="Prévia do vídeo do YouTube"
              className="h-16 w-28 rounded-lg object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{ytTitle.trim() || "Vídeo do YouTube"}</p>
              <p className="truncate text-[11px] text-muted-foreground">ID {ytId}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="cf-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar mídia pelo nome…"
            className="h-11 rounded-xl pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-xl bg-secondary p-1">
          {([
            ["all", "Todas"],
            ["video", "Vídeos"],
            ["image", "Imagens"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={
                "rounded-lg px-3 py-2 text-sm font-bold transition-colors " +
                (filter === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-primary")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((m) => (
          <article key={m.id} className="cf-card group overflow-hidden p-0">
            <div className="relative flex aspect-video items-center justify-center bg-foreground/90">
              {m.type === "youtube" ? (
                <img
                  src={"https://i.ytimg.com/vi/" + (parseYoutubeId(m.url) || "") + "/mqdefault.jpg"}
                  alt={m.title}
                  className="h-full w-full object-contain"
                />
              ) : m.type === "image" ? (
                <img src={m.url} alt={m.title} className="h-full w-full object-contain" />
              ) : (
                <video src={m.url} muted className="h-full w-full object-contain" />
              )}
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                {m.type === "youtube" ? (
                  <Youtube className="h-3 w-3" />
                ) : m.type === "video" ? (
                  <Film className="h-3 w-3" />
                ) : (
                  <ImageIcon className="h-3 w-3" />
                )}
                {m.type === "youtube" ? "YouTube" : m.type === "video" ? "Vídeo" : "Imagem"}
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
                {m.qr_url ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-primary">
                    <QrCode className="h-3 w-3" /> QR
                  </span>
                ) : null}
              </div>

              <div className="mt-2.5 space-y-1">
                <Label className="text-[11px] text-muted-foreground" htmlFor={"qr-media-" + m.id}>
                  QR Code do anúncio (WhatsApp, catálogo, Instagram)
                </Label>
                <Input
                  id={"qr-media-" + m.id}
                  defaultValue={m.qr_url || ""}
                  placeholder="https://wa.me/5599999999999"
                  onBlur={(e) => saveQr(m, e.target.value)}
                  className="h-9 rounded-lg text-xs"
                />
              </div>
            </div>
          </article>
        ))}
        {visible.length === 0 ? (
          <div className="cf-card p-6 text-center sm:col-span-2 lg:col-span-3">
            <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-semibold">
              {media.length ? "Nenhuma mídia corresponde ao filtro" : "Nenhuma mídia enviada ainda"}
            </p>
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
