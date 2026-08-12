// Nivelamento automático de áudio para as TVs (Web Audio API).
// Um único AudioContext por página; cada <video> recebe compressor + ganho mestre.

type Chain = { gain: GainNode };

let ctx: AudioContext | null = null;
let compressor: DynamicsCompressorNode | null = null;
const chains = new WeakMap<HTMLMediaElement, Chain>();

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx && ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function getCompressor(context: AudioContext): DynamicsCompressorNode {
  if (compressor) return compressor;
  const node = context.createDynamicsCompressor();
  node.threshold.value = -24;
  node.knee.value = 30;
  node.ratio.value = 12;
  node.attack.value = 0.003;
  node.release.value = 0.25;
  node.connect(context.destination);
  compressor = node;
  return node;
}

/** Liga o elemento ao compressor e aplica o volume mestre (0–100). */
export function attachAudioChain(el: HTMLMediaElement | null, volume: number): void {
  if (!el) return;
  const level = Math.min(1, Math.max(0, volume / 100));
  const existing = chains.get(el);
  if (existing) {
    existing.gain.gain.value = level;
    return;
  }
  const context = getContext();
  if (!context) {
    el.volume = level;
    return;
  }
  try {
    const source = context.createMediaElementSource(el);
    const gain = context.createGain();
    gain.gain.value = level;
    source.connect(gain);
    gain.connect(getCompressor(context));
    chains.set(el, { gain });
  } catch {
    el.volume = level;
  }
}

/** Retoma o contexto após qualquer interação/autoplay da TV. */
export function resumeAudio(): void {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}
