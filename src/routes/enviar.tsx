import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BRAND, LOGO_URL } from "@/lib/centerfrios";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Camera, CheckCircle2, Loader2, Upload } from "lucide-react";

export const Route = createFileRoute("/enviar")({
  head: () => ({
    meta: [
      { title: "Mural do Evento CENTERFRIOS — Envie sua foto" },
      {
        name: "description",
        content:
          "Envie sua foto do evento CENTERFRIOS e veja ela aparecer nas telas da loja em instantes.",
      },
      { property: "og:title", content: "Mural do Evento CENTERFRIOS" },
      {
        property: "og:description",
        content: "Participe do mural interativo: envie sua foto e apareça nas TVs do evento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EnviarPage,
});

const MAX_BYTES = 1.5 * 1024 * 1024;
const DEVICE_KEY = "cf_device_hash";
const HISTORY_KEY = "cf_upload_history";

function deviceHash(): string {
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      "dev-" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 12) +
      Math.random().toString(36).slice(2, 8);
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function recentUploads(): number[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const arr = raw ? (JSON.parse(raw) as number[]) : [];
    const cutoff = Date.now() - 5 * 60 * 1000;
    return arr.filter((t) => t > cutoff);
  } catch {
    return [];
  }
}

function pushUpload() {
  const list = recentUploads().concat([Date.now()]);
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

/** Compacta a imagem no próprio celular do cliente até ~1.5MB. */
async function compress(file: File): Promise<Blob> {
  if (file.size <= MAX_BYTES && file.type === "image/jpeg") return file;

  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Não foi possível ler a imagem"));
      el.src = bitmapUrl;
    });

    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const maxSide = 1920;
    if (Math.max(width, height) > maxSide) {
      const scale = maxSide / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.82;
    let blob: Blob | null = null;
    for (let i = 0; i < 5; i++) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
      );
      if (!blob || blob.size <= MAX_BYTES) break;
      quality -= 0.15;
    }
    return blob || file;
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

function EnviarPage() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    if (file.type.indexOf("image") !== 0) {
      toast.error("Envie uma foto (JPG ou PNG)");
      return;
    }
    if (recentUploads().length >= 3) {
      toast.error("Limite de 3 fotos a cada 5 minutos. Tente novamente em instantes.");
      return;
    }

    setBusy(true);
    try {
      const blob = await compress(file);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });

      const path =
        "evento/" + Date.now() + "-" + Math.random().toString(36).slice(2, 9) + ".jpg";
      const { error: upErr } = await supabase.storage
        .from("event-photos")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw upErr;

      const { error } = await supabase.rpc("submit_event_photo", {
        _image_url: "",
        _storage_path: path,
        _device_hash: deviceHash(),
      });
      if (error) {
        if (error.message.indexOf("rate_limit") !== -1) {
          toast.error("Limite de 3 fotos a cada 5 minutos atingido.");
          return;
        }
        throw error;
      }

      pushUpload();
      setSent((n) => n + 1);
      toast.success("Foto enviada! Em instantes ela pode aparecer nas telas.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha no envio";
      toast.error(message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <AppErrorBoundary>
      <main className="min-h-screen bg-background">
        <header className="cf-header px-5 py-6 text-center">
          <img src={LOGO_URL} alt="CENTERFRIOS" className="mx-auto h-12 w-auto rounded-md" />
          <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-primary-foreground/85">
            Mural interativo do evento
          </p>
        </header>

        <section className="mx-auto w-full max-w-md px-4 py-8">
          <h1 className="text-center text-2xl font-extrabold tracking-tight">
            Envie sua foto e apareça nas telas
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            A imagem é compactada automaticamente no seu celular antes do envio.
          </p>

          <div className="cf-card mt-6 p-5">
            <div className="grid aspect-square place-items-center overflow-hidden rounded-2xl border border-dashed border-primary/30 bg-secondary/50">
              {preview ? (
                <img src={preview} alt="Sua foto" className="h-full w-full object-cover" />
              ) : (
                <div className="text-center">
                  <Camera className="mx-auto h-10 w-10 text-primary/60" />
                  <p className="mt-2 text-sm font-semibold text-muted-foreground">
                    Toque no botão abaixo
                  </p>
                </div>
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(e.target.files && e.target.files[0])}
            />

            <Button
              className="mt-4 h-14 w-full rounded-2xl text-base font-extrabold"
              disabled={busy}
              onClick={() => inputRef.current && inputRef.current.click()}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Enviando…
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-5 w-5" /> Tirar ou escolher foto
                </>
              )}
            </Button>

            {sent > 0 ? (
              <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-bold text-success">
                <CheckCircle2 className="h-4 w-4" /> {sent} foto{sent === 1 ? "" : "s"} enviada
                {sent === 1 ? "" : "s"}
              </p>
            ) : null}

            <p className="mt-3 text-center text-xs text-muted-foreground">
              Limite de 3 envios a cada 5 minutos por aparelho.
            </p>
          </div>

          <p className="mt-8 text-center text-xs font-bold text-primary">{BRAND.slogan}</p>
        </section>
      </main>
    </AppErrorBoundary>
  );
}
