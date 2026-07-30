import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isOnline, type TvRow } from "@/lib/centerfrios";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Radio, Square } from "lucide-react";

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

      timerRef.current = setInterval(() => sendFrame(ids), FRAME_INTERVAL_MS);
      toast.success("Transmissão iniciada");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível acessar a câmera";
      toast.error(message);
    }
  }

  async function sendFrame(ids: string[]) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;
    canvas.width = 960;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 960);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL("image/jpeg", 0.55);

    const rows = ids.map((id) => ({ tv_id: id, frame_data: frame }));
    await supabase.from("live_frames").insert(rows);
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

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-bold">TVs que receberão a transmissão</h3>
        <div className="mt-3 space-y-2">
          {tvs.map((tv) => (
            <div key={tv.id} className="flex items-center gap-2">
              <Checkbox
                id={"tv-" + tv.id}
                checked={!!targets[tv.id]}
                disabled={live}
                onCheckedChange={(v) =>
                  setTargets((prev) => ({ ...prev, [tv.id]: v === true }))
                }
              />
              <Label htmlFor={"tv-" + tv.id} className="font-normal">
                {tv.name}{" "}
                <span className="text-xs text-muted-foreground">
                  ({isOnline(tv.last_ping) ? "online" : "offline"})
                </span>
              </Label>
            </div>
          ))}
          {tvs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma TV pareada.</p>
          ) : null}
        </div>

        <div className="mt-4 flex gap-2">
          {!live ? (
            <Button onClick={startLive} className="font-bold">
              <Radio className="mr-2 h-4 w-4" /> Iniciar Live no Celular
            </Button>
          ) : (
            <Button onClick={stopLive} variant="destructive" className="font-bold">
              <Square className="mr-2 h-4 w-4" /> Encerrar Live
            </Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="aspect-video bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full object-contain"
          />
        </div>
        <p className="p-3 text-xs text-muted-foreground">
          Pré-visualização da câmera. As TVs recebem quadros em tempo quase real (aprox. 1 por
          segundo), compatível com navegadores antigos de Smart TV.
        </p>
      </Card>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
