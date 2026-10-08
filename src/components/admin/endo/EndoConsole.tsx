// Endomarketing — Mesa de Controle ao vivo (só interface; a lógica fica no EndomarketingManager).
import type { EndoState } from "@/lib/centerfrios";
import { youtubeThumb } from "@/lib/endomarketing";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Power,
  Repeat,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";

export function EndoConsole({
  state,
  volume,
  busy,
  hasNext,
  onPlay,
  onPause,
  onRestart,
  onNext,
  onLoop,
  onFullscreen,
  onVolume,
  onMute,
  onEnd,
}: {
  state: EndoState | null;
  volume: number;
  busy: boolean;
  hasNext: boolean;
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  onNext: () => void;
  onLoop: () => void;
  onFullscreen: () => void;
  onVolume: (v: number) => void;
  onMute: () => void;
  onEnd: () => void;
}) {
  const on = !!state;
  return (
    <section className="cf-card overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="relative aspect-video bg-black">
          {state ? (
            <img
              src={youtubeThumb(state.videoId)}
              alt=""
              className="h-full w-full object-cover opacity-90"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm font-semibold text-white/60">
              Nenhuma atividade no ar
            </div>
          )}
          {state ? (
            <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-destructive px-3 py-1 text-xs font-extrabold text-destructive-foreground">
              <span className="cf-live-glow h-2 w-2 rounded-full bg-destructive-foreground" />
              {state.playing ? "NO AR" : "PAUSADO"}
            </span>
          ) : null}
        </div>

        <div className="grid content-start gap-4 p-5">
          <div className="min-w-0">
            <h3 className="text-base font-extrabold">Mesa de Controle</h3>
            {state ? (
              <>
                <p className="truncate text-sm font-bold">{state.momentTitle || state.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {state.momentTitle ? state.title + " · " : ""}ID {state.videoId}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Dispare um momento ou um vídeo da fila.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {state?.playing ? (
              <Button
                onClick={onPause}
                disabled={!on || busy}
                className="h-11 rounded-xl px-5 font-extrabold"
              >
                <Pause className="mr-2 h-4 w-4" /> Pausar
              </Button>
            ) : (
              <Button
                onClick={onPlay}
                disabled={!on || busy}
                className="h-11 rounded-xl px-5 font-extrabold"
              >
                <Play className="mr-2 h-4 w-4" /> Play
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={onRestart}
              disabled={!on || busy}
              className="h-11 rounded-xl font-bold"
            >
              <RotateCcw className="mr-2 h-4 w-4" /> Início (0:00)
            </Button>
            <Button
              variant="secondary"
              onClick={onNext}
              disabled={!on || busy || !hasNext}
              className="h-11 rounded-xl font-bold"
            >
              <SkipForward className="mr-2 h-4 w-4" /> Próximo da fila
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={state?.loop ? "default" : "outline"}
              onClick={onLoop}
              disabled={!on || busy}
              className="rounded-xl font-bold"
              aria-pressed={!!state?.loop}
            >
              <Repeat className="mr-2 h-4 w-4" /> Loop {state?.loop ? "ligado" : "desligado"}
            </Button>
            <Button
              variant={state?.fullscreen ? "default" : "outline"}
              onClick={onFullscreen}
              disabled={!on || busy}
              className="rounded-xl font-bold"
              aria-pressed={!!state?.fullscreen}
            >
              {state?.fullscreen ? (
                <Maximize2 className="mr-2 h-4 w-4" />
              ) : (
                <Minimize2 className="mr-2 h-4 w-4" />
              )}
              {state?.fullscreen ? "Tela cheia total" : "Com barra institucional"}
            </Button>
          </div>

          <div className="grid grid-cols-[auto_minmax(0,1fr)_3rem] items-center gap-3">
            <Button
              size="icon"
              variant={state?.isMuted ? "destructive" : "outline"}
              onClick={onMute}
              disabled={!on || busy}
              aria-label={state?.isMuted ? "Tirar do mudo" : "Mudo"}
              className="rounded-xl"
            >
              {state?.isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
            <Slider
              value={[volume]}
              min={0}
              max={100}
              step={1}
              disabled={!on}
              onValueChange={(v) => onVolume(v[0] ?? 0)}
              aria-label="Volume"
            />
            <span className="text-right text-sm font-extrabold tabular-nums">{volume}%</span>
          </div>

          <Button
            variant="destructive"
            onClick={onEnd}
            disabled={busy}
            className="h-12 rounded-xl text-base font-extrabold"
          >
            <Power className="mr-2 h-5 w-5" /> Encerrar Atividade / Voltar à Programação Normal
          </Button>
        </div>
      </div>
    </section>
  );
}
