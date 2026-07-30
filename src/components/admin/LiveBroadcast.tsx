import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isOnline, type TvRow } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Radio, Square, Camera, Tv } from "lucide-react";

const FRAME_INTERVAL_MS = 900;

export function LiveBroadcast() {
  const [tvs, setTvs] = useState<TvRow[]>([]);
  const [targets, setTargets] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const { data } = await supabase.from("tvs").select("*").eq("is_paired", true);
    setTvs((data || []) as unknown as TvRow[]);
  }

  useEffect(() => {
    load();
    return () => {
      stopLive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectedIds() {
    return Object.keys(targets).filter((id) => targets[id]);
  }

  async function startLive() {
    const ids = selectedIds();
    if (ids.length === 0) {
      toast.error("Selecione ao menos uma TV");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      await supabase.from("tvs").update({ is_live_active: true }).in("id", ids);
      setLive(true);

      timerRef.current = setInterval(() => sendFrame(), FRAME_INTERVAL_MS);
      toast.success("Transmissão iniciada");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível acessar a câmera";
      toast.error(message);
    }
  }

  async function sendFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;
    canvas.width = 960;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 960);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL("image/jpeg", 0.55);

    await supabase.from("live_frames").insert({ frame_data: frame });
  }

  async function stopLive() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const ids = selectedIds();
    if (ids.length) await supabase.from("tvs").update({ is_live_active: false }).in("id", ids);
    setLive(false);
  }

  const count = selectedIds().length;

  return (
    <div className="space-y-5">
      <section className="cf-card overflow-hidden p-0">
        <div className="relative aspect-video bg-foreground">
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full object-contain"
          />
          {!live ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <Camera className="mx-auto h-9 w-9 text-background/50" />
                <p className="mt-2 text-sm font-semibold text-background/70">
                  Visor da câmera desligado
                </p>
              </div>
            </div>
          ) : (
            <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-destructive px-3 py-1 text-xs font-extrabold text-destructive-foreground">
              <span className="cf-live-glow h-2 w-2 rounded-full bg-destructive-foreground" />
              AO VIVO
            </span>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 sm:flex sm:justify-between">
          <p className="min-w-0 text-xs text-muted-foreground">
            As TVs recebem quadros em tempo quase real (aprox. 1 por segundo), compatível com
            navegadores antigos de Smart TV.
          </p>
          {!live ? (
            <Button
              onClick={startLive}
              className="h-11 shrink-0 rounded-xl px-6 font-extrabold shadow-lg shadow-primary/25"
            >
              <Radio className="mr-2 h-4 w-4" /> Iniciar Live
            </Button>
          ) : (
            <Button
              onClick={stopLive}
              variant="destructive"
              className="cf-live-glow h-11 shrink-0 rounded-xl px-6 font-extrabold"
            >
              <Square className="mr-2 h-4 w-4" /> Encerrar Live
            </Button>
          )}
        </div>
      </section>

      <section className="cf-card p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">TVs direcionadas</h3>
            <p className="text-xs text-muted-foreground">
              Selecione as telas que exibirão a transmissão.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-bold text-secondary-foreground">
            {count} selecionada{count === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {tvs.map((tv) => {
            const online = isOnline(tv.last_ping);
            const checked = !!targets[tv.id];
            return (
              <label
                key={tv.id}
                htmlFor={"tv-" + tv.id}
                className={
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors " +
                  (checked ? "border-primary bg-secondary/60" : "border-border bg-card")
                }
              >
                <Checkbox
                  id={"tv-" + tv.id}
                  checked={checked}
                  disabled={live}
                  onCheckedChange={(v) =>
                    setTargets((prev) => ({ ...prev, [tv.id]: v === true }))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{tv.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                    <span
                      className={
                        online
                          ? "cf-dot-online h-1.5 w-1.5"
                          : "h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
                      }
                    />
                    {online ? "Online" : "Offline"}
                  </span>
                </span>
              </label>
            );
          })}
          {tvs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center sm:col-span-2">
              <Tv className="mx-auto h-7 w-7 text-muted-foreground/60" />
              <p className="mt-2 text-sm text-muted-foreground">Nenhuma TV pareada.</p>
            </div>
          ) : null}
        </div>
      </section>

      <Label className="sr-only">Canvas de captura</Label>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
