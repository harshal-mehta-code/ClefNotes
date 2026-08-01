/**
 * Live pitch detection from the microphone.
 *
 * Autocorrelation (the core of YIN) rather than an FFT peak: it tracks the
 * *period* of the waveform, so it reports the note a player hears even when the
 * fundamental is weak — which is the normal case for a violin, a flute, or a
 * voice.
 */

export interface PitchReading {
  /** Detected frequency in Hz, or 0 when nothing confident was found. */
  hz: number;
  /** 0-1 clarity of the detection. */
  clarity: number;
  /** RMS level, for the input meter. */
  level: number;
}

const MIN_HZ = 65; // ~C2
const MAX_HZ = 1400; // ~F6

export class PitchTracker {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer = new Float32Array(2048);
  private lastHz = 0;

  get active() {
    return this.analyser != null;
  }

  async start(): Promise<void> {
    if (this.analyser) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    // A gentle high-pass keeps room rumble from being read as a low note.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 55;
    source.connect(hp);
    hp.connect(analyser);

    this.ctx = ctx;
    this.stream = stream;
    this.analyser = analyser;
    this.buffer = new Float32Array(analyser.fftSize);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.lastHz = 0;
  }

  read(): PitchReading {
    const analyser = this.analyser;
    if (!analyser || !this.ctx) return { hz: 0, clarity: 0, level: 0 };
    analyser.getFloatTimeDomainData(this.buffer);
    const buf = this.buffer;
    const n = buf.length;

    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.008) {
      this.lastHz = 0;
      return { hz: 0, clarity: 0, level: rms };
    }

    const rate = this.ctx.sampleRate;
    const minLag = Math.floor(rate / MAX_HZ);
    const maxLag = Math.min(n - 1, Math.floor(rate / MIN_HZ));

    // Difference function: d[lag] is small where the wave repeats.
    let bestLag = -1;
    let bestValue = Infinity;
    let runningSum = 0;
    let previous = 1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) {
        const delta = buf[i] - buf[i + lag];
        sum += delta * delta;
      }
      runningSum += sum;
      // Cumulative mean normalisation — this is what makes YIN robust against
      // octave errors compared with plain autocorrelation.
      const normalised = sum === 0 ? 1 : (sum * (lag - minLag + 1)) / runningSum;

      if (normalised < 0.14 && normalised > previous) {
        bestLag = lag - 1;
        bestValue = previous;
        break;
      }
      if (normalised < bestValue) {
        bestValue = normalised;
        bestLag = lag;
      }
      previous = normalised;
    }

    if (bestLag < 0 || bestValue > 0.42) {
      return { hz: 0, clarity: Math.max(0, 1 - bestValue), level: rms };
    }

    // Parabolic interpolation around the minimum for sub-sample accuracy.
    let refined = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const diff = (lag: number) => {
        let s = 0;
        for (let i = 0; i < n - lag; i++) {
          const d = buf[i] - buf[i + lag];
          s += d * d;
        }
        return s;
      };
      const a = diff(bestLag - 1);
      const b = diff(bestLag);
      const c = diff(bestLag + 1);
      const denom = 2 * (2 * b - a - c);
      if (denom !== 0) refined = bestLag + (c - a) / denom;
    }

    const hz = rate / refined;
    if (hz < MIN_HZ || hz > MAX_HZ) return { hz: 0, clarity: 0, level: rms };

    // Light smoothing so the readout doesn't jitter between frames.
    this.lastHz = this.lastHz ? this.lastHz * 0.35 + hz * 0.65 : hz;
    return { hz: this.lastHz, clarity: 1 - bestValue, level: rms };
  }
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Signed distance from the nearest semitone, in cents. */
export function centsOff(hz: number): number {
  const m = hzToMidi(hz);
  return (m - Math.round(m)) * 100;
}
