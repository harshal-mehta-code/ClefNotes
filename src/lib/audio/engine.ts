import type { PlayNote, Score } from '../score/types';
import { midiToFreq, qToSec, secToQ } from '../score/types';
import {
  INSTRUMENTS,
  noiseBuffer,
  periodicWave,
  type InstrumentId,
  type InstrumentPreset,
} from './instruments';
import { sing, VOICE_PRESETS, type VoiceTypeId } from './clefvox';

/**
 * The transport.
 *
 * Two clocks would drift, so there is only one: everything — audio, the moving
 * cursor, the highlighted note, the metronome — is derived from
 * `AudioContext.currentTime`. The UI *reads* that clock each animation frame;
 * it never drives it.
 *
 * Notes are scheduled into a short lookahead window rather than one-by-one on a
 * timer, which is what keeps timing sample-accurate while still allowing the
 * tempo to change mid-phrase.
 */

const LOOKAHEAD_S = 0.18;
const TICK_MS = 25;

export interface PartMix {
  instrument: InstrumentId;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  /** Semitone offset applied to this part only. */
  transpose: number;
  voiceType: VoiceTypeId;
}

export interface TransportState {
  playing: boolean;
  /** Position in quarter notes. */
  q: number;
  bpm: number;
  /** 0.25 – 2.0, multiplies bpm. */
  rate: number;
  loop: boolean;
  loopStartQ: number;
  loopEndQ: number;
  countIn: boolean;
  metronome: boolean;
  swing: number;
  humanize: number;
  /** Global semitone transposition. */
  transpose: number;
  masterVolume: number;
  reverb: number;
}

export const DEFAULT_TRANSPORT: TransportState = {
  playing: false,
  q: 0,
  bpm: 96,
  rate: 1,
  loop: false,
  loopStartQ: 0,
  loopEndQ: 0,
  countIn: false,
  metronome: false,
  swing: 0,
  humanize: 0.12,
  transpose: 0,
  masterVolume: 0.85,
  reverb: 0.3,
};

interface LiveVoice {
  nodes: AudioScheduledSourceNode[];
  startsAt: number;
  endsAt: number;
}

interface Anchor {
  atTime: number;
  atQ: number;
}

export type EngineListener = (q: number, playing: boolean) => void;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private convolver!: ConvolverNode;
  private partNodes: Array<{ gain: GainNode; pan: StereoPannerNode }> = [];

  private score: Score | null = null;
  private mixes: PartMix[] = [];
  private state: TransportState = { ...DEFAULT_TRANSPORT };

  private timer: number | null = null;
  private live: LiveVoice[] = [];
  private anchors: Anchor[] = [];

  /** Scheduler cursor. */
  private cursorQ = 0;
  private cursorTime = 0;
  private noteIdx = 0;
  private metroQ = 0;

  private listeners = new Set<EngineListener>();
  private endedCallback: (() => void) | null = null;

  // -- lifecycle ------------------------------------------------------------

  /** Must be called from a user gesture; browsers won't start audio otherwise. */
  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.buildGraph();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  private buildGraph() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.state.masterVolume;
    this.master.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 2.2, 2.6);

    this.dry.connect(this.master);
    this.wet.connect(this.convolver);
    this.convolver.connect(this.master);
    this.setReverb(this.state.reverb);
  }

  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  subscribe(fn: EngineListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onEnded(fn: (() => void) | null) {
    this.endedCallback = fn;
  }

  // -- configuration --------------------------------------------------------

  setScore(score: Score, mixes: PartMix[]) {
    this.stop();
    this.score = score;
    this.mixes = mixes;
    this.rebuildPartNodes();
  }

  setMixes(mixes: PartMix[]) {
    this.mixes = mixes;
    if (!this.ctx) return;
    const anySolo = mixes.some((m) => m.solo);
    mixes.forEach((m, i) => {
      const node = this.partNodes[i];
      if (!node) return;
      const audible = anySolo ? m.solo : !m.muted;
      node.gain.gain.setTargetAtTime(audible ? m.volume : 0, this.ctx!.currentTime, 0.02);
      node.pan.pan.setTargetAtTime(m.pan, this.ctx!.currentTime, 0.02);
    });
  }

  private rebuildPartNodes() {
    if (!this.ctx || !this.score) return;
    for (const n of this.partNodes) {
      n.gain.disconnect();
      n.pan.disconnect();
    }
    this.partNodes = this.score.parts.map(() => {
      const gain = this.ctx!.createGain();
      const pan = this.ctx!.createStereoPanner();
      gain.connect(pan);
      pan.connect(this.dry);
      pan.connect(this.wet);
      return { gain, pan };
    });
    this.setMixes(this.mixes);
  }

  patch(next: Partial<TransportState>) {
    const wasPlaying = this.state.playing;
    const tempoChanged =
      (next.bpm != null && next.bpm !== this.state.bpm) ||
      (next.rate != null && next.rate !== this.state.rate) ||
      (next.swing != null && next.swing !== this.state.swing);
    const loopChanged =
      (next.loop != null && next.loop !== this.state.loop) ||
      (next.loopStartQ != null && next.loopStartQ !== this.state.loopStartQ) ||
      (next.loopEndQ != null && next.loopEndQ !== this.state.loopEndQ);

    // Read the position before mutating, so a tempo change doesn't jump.
    const posBefore = wasPlaying ? this.currentQ() : this.state.q;
    this.state = { ...this.state, ...next };

    if (this.ctx) {
      if (next.masterVolume != null) {
        this.master.gain.setTargetAtTime(next.masterVolume, this.ctx.currentTime, 0.02);
      }
      if (next.reverb != null) this.setReverb(next.reverb);
    }

    if (wasPlaying && (tempoChanged || loopChanged || next.transpose != null)) {
      // Re-anchor from where we actually are, dropping anything not yet audible.
      this.reanchor(posBefore);
    } else if (!wasPlaying && next.q != null) {
      this.state.q = next.q;
      this.emit();
    }
  }

  getState(): TransportState {
    return { ...this.state, q: this.currentQ() };
  }

  private setReverb(amount: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(amount * 0.9, t, 0.05);
    this.dry.gain.setTargetAtTime(1 - amount * 0.35, t, 0.05);
  }

  // -- position -------------------------------------------------------------

  /** Current position in quarter notes, derived from the audio clock. */
  currentQ(): number {
    if (!this.ctx || !this.state.playing || !this.anchors.length) return this.state.q;
    const now = this.ctx.currentTime;
    let anchor = this.anchors[0];
    for (const a of this.anchors) {
      if (a.atTime <= now) anchor = a;
      else break;
    }
    const q = anchor.atQ + secToQ(now - anchor.atTime, this.effectiveBpm());
    if (this.state.loop && this.state.loopEndQ > this.state.loopStartQ) {
      return Math.min(q, this.state.loopEndQ);
    }
    return Math.min(q, this.score?.totalQ ?? q);
  }

  private effectiveBpm(): number {
    return Math.max(8, this.state.bpm * this.state.rate);
  }

  // -- playback -------------------------------------------------------------

  async play(fromQ?: number) {
    if (!this.score) return;
    const ctx = await this.ensureContext();
    if (this.state.playing) return;

    let start = fromQ ?? this.state.q;
    const { loop, loopStartQ, loopEndQ } = this.state;
    if (loop && loopEndQ > loopStartQ && (start < loopStartQ || start >= loopEndQ)) {
      start = loopStartQ;
    }
    if (start >= (this.score.totalQ ?? 0) - 1e-6) start = 0;

    this.state.playing = true;
    this.state.q = start;

    let t0 = ctx.currentTime + 0.08;
    if (this.state.countIn) {
      const beats = this.score.beatsPerBar || 4;
      for (let i = 0; i < beats; i++) {
        this.click(t0 + qToSec(i, this.effectiveBpm()), i === 0);
      }
      t0 += qToSec(beats, this.effectiveBpm());
    }

    this.cursorQ = start;
    this.cursorTime = t0;
    this.noteIdx = this.firstNoteAtOrAfter(start);
    this.metroQ = Math.ceil(start);
    this.anchors = [{ atTime: t0, atQ: start }];

    this.startTimer();
    this.emit();
  }

  pause() {
    if (!this.state.playing) return;
    const q = this.currentQ();
    this.state.playing = false;
    this.state.q = q;
    this.stopTimer();
    this.killVoices(true);
    this.emit();
  }

  stop() {
    this.state.playing = false;
    this.state.q = this.state.loop ? this.state.loopStartQ : 0;
    this.stopTimer();
    this.killVoices(false);
    this.anchors = [];
    this.emit();
  }

  seek(q: number) {
    const clamped = Math.max(0, Math.min(q, this.score?.totalQ ?? q));
    if (this.state.playing) {
      this.killVoices(true);
      this.state.q = clamped;
      this.reanchor(clamped);
    } else {
      this.state.q = clamped;
      this.emit();
    }
  }

  private reanchor(atQ: number) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + 0.06;
    this.cursorQ = atQ;
    this.cursorTime = t0;
    this.noteIdx = this.firstNoteAtOrAfter(atQ);
    this.metroQ = Math.ceil(atQ);
    this.anchors = [{ atTime: t0, atQ }];
    if (this.state.playing && this.timer == null) this.startTimer();
  }

  private firstNoteAtOrAfter(q: number): number {
    const notes = this.score?.notes ?? [];
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].q < q - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private startTimer() {
    this.stopTimer();
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer() {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // -- the scheduler --------------------------------------------------------

  private tick() {
    if (!this.ctx || !this.score || !this.state.playing) return;
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD_S;
    const notes = this.score.notes;
    const bpm = this.effectiveBpm();
    const { loop, loopStartQ, loopEndQ } = this.state;
    const loopActive = loop && loopEndQ > loopStartQ + 1e-6;
    const endQ = loopActive ? loopEndQ : this.score.totalQ;

    let guard = 0;
    while (this.cursorTime < horizon && guard++ < 4000) {
      const next = notes[this.noteIdx];
      const passEnded = !next || next.q >= endQ - 1e-9;

      if (passEnded) {
        const remaining = qToSec(endQ - this.cursorQ, bpm);
        const boundaryTime = this.cursorTime + remaining;
        if (loopActive) {
          this.cursorTime = boundaryTime;
          this.cursorQ = loopStartQ;
          this.noteIdx = this.firstNoteAtOrAfter(loopStartQ);
          this.metroQ = Math.ceil(loopStartQ);
          this.anchors.push({ atTime: boundaryTime, atQ: loopStartQ });
          continue;
        }
        // Not looping: let the tail ring, then report the end.
        if (boundaryTime <= now) {
          this.finish();
          return;
        }
        break;
      }

      const when = this.cursorTime + qToSec(next.q - this.cursorQ, bpm);
      if (when >= horizon) break;

      this.scheduleNote(next, when, bpm);
      this.cursorTime = when;
      this.cursorQ = next.q;
      this.noteIdx++;
    }

    // Metronome runs on its own cursor so it survives loop wraps.
    if (this.state.metronome) this.scheduleClicks(horizon, bpm, endQ, loopActive);

    this.pruneAnchors(now);
    this.pruneVoices(now);
    this.emit();
  }

  private scheduleClicks(horizon: number, bpm: number, endQ: number, loopActive: boolean) {
    const beats = this.score?.beatsPerBar ?? 4;
    let guard = 0;
    while (guard++ < 512) {
      const anchor = this.anchorFor(this.metroQ);
      if (!anchor) break;
      const when = anchor.atTime + qToSec(this.metroQ - anchor.atQ, bpm);
      if (when >= horizon) break;
      if (this.metroQ >= endQ) {
        if (!loopActive) break;
        this.metroQ = Math.ceil(this.state.loopStartQ);
        continue;
      }
      const beatIndex = Math.round(this.metroQ) % beats;
      this.click(when, beatIndex === 0);
      this.metroQ += 1;
    }
  }

  private anchorFor(q: number): Anchor | null {
    let best: Anchor | null = null;
    for (const a of this.anchors) {
      if (a.atQ <= q + 1e-9) best = a;
    }
    return best ?? this.anchors[0] ?? null;
  }

  private finish() {
    this.state.playing = false;
    this.state.q = this.score?.totalQ ?? 0;
    this.stopTimer();
    this.emit();
    this.endedCallback?.();
  }

  private pruneAnchors(now: number) {
    while (this.anchors.length > 1 && this.anchors[1].atTime <= now) this.anchors.shift();
  }

  private pruneVoices(now: number) {
    this.live = this.live.filter((v) => v.endsAt > now - 0.5);
  }

  // -- voice construction ---------------------------------------------------

  private scheduleNote(note: PlayNote, when: number, bpm: number) {
    const mix = this.mixes[note.part];
    if (!mix) return;
    const anySolo = this.mixes.some((m) => m.solo);
    if (anySolo ? !mix.solo : mix.muted) return;

    const dest = this.partNodes[note.part]?.gain;
    if (!dest || !this.ctx) return;

    // Swing pushes the second eighth of each beat later.
    let at = when;
    if (this.state.swing > 0) {
      const pos = note.q % 1;
      if (Math.abs(pos - 0.5) < 0.02) at += qToSec(0.5 * this.state.swing * 0.5, bpm);
    }
    if (this.state.humanize > 0) {
      at += (Math.random() - 0.5) * 0.012 * this.state.humanize * 8;
    }
    at = Math.max(at, this.ctx.currentTime + 0.005);

    const midi = note.midi + this.state.transpose + mix.transpose;
    const preset = INSTRUMENTS[mix.instrument];
    const articulation = preset.articulation ?? 0.96;
    const dur = Math.max(0.06, qToSec(note.qDur, bpm) * articulation);
    const velocity = 1 - (this.state.humanize > 0 ? Math.random() * 0.12 * this.state.humanize * 3 : 0);

    if (mix.instrument === 'voice') {
      const nodes = sing(this.ctx, dest, {
        freq: midiToFreq(midi),
        when: at,
        duration: dur,
        syllable: note.syllable,
        preset: VOICE_PRESETS[mix.voiceType] ?? VOICE_PRESETS.alto,
        velocity,
      });
      this.live.push({ nodes, startsAt: at, endsAt: at + dur + 0.6 });
      return;
    }

    const nodes = this.buildVoice(preset, midiToFreq(midi), at, dur, velocity, dest);
    this.live.push({ nodes, startsAt: at, endsAt: at + dur + preset.release + 0.2 });
  }

  private buildVoice(
    p: InstrumentPreset,
    freq: number,
    when: number,
    dur: number,
    velocity: number,
    dest: AudioNode,
  ): AudioScheduledSourceNode[] {
    const ctx = this.ctx!;
    const started: AudioScheduledSourceNode[] = [];

    const amp = ctx.createGain();
    amp.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.q ?? 0.9;
    amp.connect(filter);
    filter.connect(dest);

    // Cutoff tracks pitch so high notes stay bright and low notes stay warm.
    const track = p.keyTrack ?? 0.5;
    const base = p.cutoff * Math.pow(freq / 261.63, track);
    const cutoff = Math.min(ctx.sampleRate / 2.2, Math.max(180, base));
    filter.frequency.setValueAtTime(cutoff, when);
    if (p.filterEnv) {
      const peak = Math.min(ctx.sampleRate / 2.2, cutoff * Math.pow(2, p.filterEnv));
      filter.frequency.setValueAtTime(peak, when);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(180, cutoff),
        when + (p.filterEnvDecay ?? 0.2),
      );
    }

    const wave = periodicWave(ctx, p.partials);
    const unison = p.unison ?? 1;
    for (let u = 0; u < unison; u++) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = freq;
      if (unison > 1) {
        osc.detune.value = (u - (unison - 1) / 2) * (p.detuneCents ?? 8);
      }
      if (p.vibratoDepth && dur > (p.vibratoDelay ?? 0) + 0.12) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = (p.vibratoRate ?? 5) + (Math.random() - 0.5) * 0.3;
        lg.gain.setValueAtTime(0, when);
        lg.gain.setValueAtTime(0, when + (p.vibratoDelay ?? 0.3));
        lg.gain.linearRampToValueAtTime(p.vibratoDepth, when + (p.vibratoDelay ?? 0.3) + 0.2);
        lfo.connect(lg);
        lg.connect(osc.detune);
        lfo.start(when);
        lfo.stop(when + dur + p.release + 0.1);
        started.push(lfo);
      }
      const ug = ctx.createGain();
      ug.gain.value = 1 / Math.sqrt(unison);
      osc.connect(ug);
      ug.connect(amp);
      osc.start(when);
      osc.stop(when + dur + p.release + 0.1);
      started.push(osc);
    }

    // Attack transient: hammer thud, breath, or pick noise.
    if (p.noise) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = Math.min(9000, freq * 4);
      hp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(p.noise * velocity, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + (p.noiseDecay ?? 0.05) + 0.01);
      src.connect(hp);
      hp.connect(g);
      g.connect(dest);
      src.start(when);
      src.stop(when + (p.noiseDecay ?? 0.05) + 0.12);
      started.push(src);
    }

    const peak = p.gain * velocity;
    const sustainLevel = Math.max(0.0002, peak * p.sustain);
    const endAt = when + dur;
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(peak, when + p.attack);
    if (p.sustain <= 0.001) {
      // Percussive: one long decay, no sustain stage.
      amp.gain.exponentialRampToValueAtTime(0.0002, when + p.attack + p.decay);
    } else {
      amp.gain.exponentialRampToValueAtTime(sustainLevel, when + p.attack + p.decay);
      amp.gain.setValueAtTime(sustainLevel, Math.max(endAt - 0.001, when + p.attack + p.decay));
      amp.gain.exponentialRampToValueAtTime(0.0002, endAt + p.release);
    }

    return started;
  }

  /** Audition a single note — used by step mode and by clicking a note. */
  async preview(midi: number, partIndex = 0, duration = 0.5, syllable?: string) {
    const ctx = await this.ensureContext();
    const mix = this.mixes[partIndex] ?? {
      instrument: 'piano' as InstrumentId,
      volume: 0.9,
      pan: 0,
      muted: false,
      solo: false,
      transpose: 0,
      voiceType: 'alto' as VoiceTypeId,
    };
    const dest = this.partNodes[partIndex]?.gain ?? this.dry;
    const when = ctx.currentTime + 0.02;
    const freq = midiToFreq(midi + this.state.transpose + mix.transpose);
    if (mix.instrument === 'voice') {
      sing(ctx, dest, {
        freq,
        when,
        duration,
        syllable,
        preset: VOICE_PRESETS[mix.voiceType] ?? VOICE_PRESETS.alto,
      });
    } else {
      this.buildVoice(INSTRUMENTS[mix.instrument], freq, when, duration, 1, dest);
    }
  }

  private click(when: number, accent: boolean) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1600 : 1050;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(accent ? 0.16 : 0.09, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    osc.connect(g);
    g.connect(this.dry);
    osc.start(when);
    osc.stop(when + 0.08);
  }

  /** Stop sounding voices. `futureOnly` leaves audible notes to ring out. */
  private killVoices(futureOnly: boolean) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const keep: LiveVoice[] = [];
    for (const v of this.live) {
      if (futureOnly && v.startsAt <= now) {
        keep.push(v);
        continue;
      }
      for (const n of v.nodes) {
        try {
          n.stop(futureOnly ? Math.max(now, v.startsAt) : now);
        } catch {
          /* already stopped */
        }
      }
    }
    this.live = keep;
  }

  private emit() {
    const q = this.currentQ();
    for (const fn of this.listeners) fn(q, this.state.playing);
  }

  dispose() {
    this.stopTimer();
    this.killVoices(false);
    this.ctx?.close();
    this.ctx = null;
  }
}

/**
 * A synthetic room. Exponentially decaying noise is a crude impulse response,
 * but it is free, instant, and needs no download.
 */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // A short pre-delay and slightly different channels widen the image.
      const env = Math.pow(1 - t, decay);
      data[i] = (Math.random() * 2 - 1) * env * (i < rate * 0.01 ? i / (rate * 0.01) : 1);
    }
  }
  return buf;
}

export const engine = new AudioEngine();
