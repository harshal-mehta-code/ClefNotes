import { INSTRUMENTS, noiseBuffer, periodicWave, type InstrumentId } from './instruments';

/**
 * The sound.
 *
 * There is no transport and no scheduler here, because the app never plays a
 * performance — you click a note and hear it. That removes the need for a
 * timeline, which removes the need to know how long any note lasts, which is
 * the single least reliable thing to read off a page.
 *
 * What is left is small enough to be obviously correct: build a voice, play it,
 * let it go.
 */

const MAX_VOICES = 24;

class Player {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private meter: AnalyserNode | null = null;
  private live: Array<{ nodes: AudioScheduledSourceNode[]; endsAt: number; midi: number }> = [];

  instrument: InstrumentId = 'piano';
  volume = 0.9;

  /** Must be reached from a user gesture, or browsers won't start audio. */
  async ensure(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });

      // iOS silences Web Audio when the hardware mute switch is on unless the
      // session is declared as playback — which looks exactly like a broken app.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) {
        try {
          session.type = 'playback';
        } catch {
          /* older Safari has no say in it */
        }
      }

      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** An analyser on the master bus — drives the output meter. */
  createMeter(): AnalyserNode | null {
    if (!this.ctx) return null;
    if (!this.meter) {
      this.meter = this.ctx.createAnalyser();
      this.meter.fftSize = 512;
      this.master.connect(this.meter);
    }
    return this.meter;
  }

  outputLevel(): number {
    if (!this.meter) return 0;
    const buf = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  /** Which pitches are sounding right now — the keyboard reads this. */
  sounding(): number[] {
    if (!this.ctx) return [];
    const now = this.ctx.currentTime;
    return this.live.filter((v) => v.endsAt > now).map((v) => v.midi);
  }

  async play(midi: number, duration = 1.1): Promise<void> {
    const ctx = await this.ensure();
    const when = ctx.currentTime + 0.005;
    const preset = INSTRUMENTS[this.instrument] ?? INSTRUMENTS.piano;
    const { nodes, endsAt } = this.buildVoice(ctx, preset, midiToFreq(midi), when, duration);
    this.live.push({ nodes, endsAt, midi });

    // Keep a lid on how many voices can overlap while dragging across a staff.
    this.live = this.live.filter((v) => v.endsAt > ctx.currentTime - 0.3);
    while (this.live.length > MAX_VOICES) {
      const oldest = this.live.shift();
      oldest?.nodes.forEach((n) => {
        try {
          n.stop();
        } catch {
          /* already finished */
        }
      });
    }
  }

  /** Sound several pitches together. */
  async playChord(midis: number[], duration = 1.4): Promise<void> {
    for (const m of midis) await this.play(m, duration);
  }

  stopAll() {
    for (const v of this.live) {
      for (const n of v.nodes) {
        try {
          n.stop();
        } catch {
          /* already finished */
        }
      }
    }
    this.live = [];
  }

  private buildVoice(
    ctx: AudioContext,
    p: (typeof INSTRUMENTS)[InstrumentId],
    freq: number,
    when: number,
    dur: number,
  ): { nodes: AudioScheduledSourceNode[]; endsAt: number } {
    const started: AudioScheduledSourceNode[] = [];

    const amp = ctx.createGain();
    amp.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.q ?? 0.9;
    amp.connect(filter);
    filter.connect(this.master);

    const track = p.keyTrack ?? 0.5;
    const cutoff = Math.min(
      ctx.sampleRate / 2.2,
      Math.max(180, p.cutoff * Math.pow(freq / 261.63, track)),
    );
    filter.frequency.setValueAtTime(cutoff, when);
    if (p.filterEnv) {
      filter.frequency.setValueAtTime(
        Math.min(ctx.sampleRate / 2.2, cutoff * Math.pow(2, p.filterEnv)),
        when,
      );
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(180, cutoff),
        when + (p.filterEnvDecay ?? 0.2),
      );
    }

    // Shape the envelope before starting anything, so every source can be told
    // to stop after the sound has finished rather than during it.
    const endsAt = this.envelope(amp.gain, p, when, dur);
    const stopAt = endsAt + 0.05;

    const wave = periodicWave(ctx, p.partials);
    const unison = p.unison ?? 1;
    for (let u = 0; u < unison; u++) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = freq;
      if (unison > 1) osc.detune.value = (u - (unison - 1) / 2) * (p.detuneCents ?? 8);
      if (p.vibratoDepth && dur > (p.vibratoDelay ?? 0) + 0.12) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = p.vibratoRate ?? 5;
        lg.gain.setValueAtTime(0, when);
        lg.gain.setValueAtTime(0, when + (p.vibratoDelay ?? 0.3));
        lg.gain.linearRampToValueAtTime(p.vibratoDepth, when + (p.vibratoDelay ?? 0.3) + 0.2);
        lfo.connect(lg);
        lg.connect(osc.detune);
        lfo.start(when);
        lfo.stop(stopAt);
        started.push(lfo);
      }
      const ug = ctx.createGain();
      ug.gain.value = 1 / Math.sqrt(unison);
      osc.connect(ug);
      ug.connect(amp);
      osc.start(when);
      osc.stop(stopAt);
      started.push(osc);
    }

    if (p.noise) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(9000, freq * 4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(p.noise, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + (p.noiseDecay ?? 0.05) + 0.01);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      src.start(when);
      src.stop(Math.min(stopAt, when + (p.noiseDecay ?? 0.05) + 0.12));
      started.push(src);
    }

    return { nodes: started, endsAt };
  }

  /**
   * The envelope, and when the sound is actually over.
   *
   * Every point has to be scheduled later than the one before it. Web Audio
   * sorts automation events by time regardless of the order they were added, so
   * a release whose end time lands *before* the decay's — which is what happens
   * whenever an instrument decays for longer than the note is held, a piano
   * being the obvious one — does not shorten the note. It reorders into a decay
   * to silence followed by a ramp back *up* to the sustain level, and then the
   * oscillator stops mid-swell. That is a fade-out that gets louder and then
   * clicks, which is exactly what it sounded like.
   */
  private envelope(
    gain: AudioParam,
    p: (typeof INSTRUMENTS)[InstrumentId],
    when: number,
    dur: number,
  ): number {
    const FLOOR = 0.0002;
    const peak = p.gain;
    const attackAt = when + p.attack;
    const decayEnds = attackAt + p.decay;

    gain.setValueAtTime(FLOOR, when);
    gain.linearRampToValueAtTime(peak, attackAt);

    // Percussive voices have no sustain: the decay *is* the note, and it ends
    // when it has rung out rather than when the note is nominally let go.
    if (p.sustain <= 0.001) {
      gain.exponentialRampToValueAtTime(FLOOR, decayEnds);
      return decayEnds;
    }

    const sustain = Math.max(FLOOR, peak * p.sustain);
    const off = Math.max(when + dur, attackAt + 0.02);
    if (off >= decayEnds) {
      gain.exponentialRampToValueAtTime(sustain, decayEnds);
      gain.setValueAtTime(sustain, off);
    } else {
      // Let go partway down. Release from where the decay had actually got to,
      // which an exponential ramp makes exact rather than approximate.
      const level = Math.max(FLOOR, peak * Math.pow(sustain / peak, (off - attackAt) / p.decay));
      gain.exponentialRampToValueAtTime(level, off);
    }
    gain.exponentialRampToValueAtTime(FLOOR, off + p.release);
    return off + p.release;
  }
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export const player = new Player();
