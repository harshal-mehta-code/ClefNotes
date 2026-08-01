/**
 * Instrument voices, synthesised.
 *
 * Sample libraries would sound better, but they cost bandwidth and a host, and
 * ClefNotes has to stay free and work offline. So every instrument here is
 * built from oscillators, one filter and an envelope — a few hundred bytes each
 * instead of a few hundred megabytes.
 *
 * Timbre comes from `partials`: harmonic amplitudes compiled into a
 * PeriodicWave, which is both cheaper and more controllable than stacking
 * oscillators.
 */

export type InstrumentId =
  | 'piano' | 'epiano' | 'organ' | 'harpsichord'
  | 'strings' | 'violin' | 'cello' | 'pizz'
  | 'flute' | 'clarinet' | 'oboe' | 'sax'
  | 'trumpet' | 'horn'
  | 'guitar' | 'harp' | 'marimba' | 'musicbox' | 'vibes'
  | 'chiptune' | 'synthpad' | 'bass'
  | 'choir';

export interface InstrumentPreset {
  id: InstrumentId;
  name: string;
  family: 'Keys' | 'Strings' | 'Winds' | 'Brass' | 'Plucked' | 'Tuned percussion' | 'Synth' | 'Voice';
  /** Harmonic amplitudes, index 0 = fundamental. */
  partials: number[];
  /** Unison voices, detuned for width. */
  unison?: number;
  detuneCents?: number;
  attack: number;
  decay: number;
  /** 0-1 of peak. Percussive instruments use 0 with a long decay. */
  sustain: number;
  release: number;
  /** Filter cutoff in Hz at middle C, tracking the note's pitch. */
  cutoff: number;
  /** How much the cutoff follows pitch. 1 = fully proportional. */
  keyTrack?: number;
  q?: number;
  /** Extra cutoff (in octaves) at the attack, decaying away. Gives bite. */
  filterEnv?: number;
  filterEnvDecay?: number;
  vibratoRate?: number;
  vibratoDepth?: number;
  vibratoDelay?: number;
  /** Breath / hammer noise mixed into the attack. */
  noise?: number;
  noiseDecay?: number;
  gain: number;
  /** Notes shorter than their written value, as a fraction. Keeps lines clear. */
  articulation?: number;
  /** Comfortable range of the real instrument, for reference. */
  range: [number, number];
}

/** Slightly irregular partial sets read as "real" where clean ratios read as synthetic. */
const P = {
  piano: [1, 0.62, 0.38, 0.28, 0.14, 0.09, 0.06, 0.04, 0.02, 0.015],
  epiano: [1, 0.18, 0.42, 0.08, 0.16, 0.03, 0.05],
  organ: [1, 0.55, 0.75, 0.42, 0.2, 0.35, 0.08, 0.22],
  harpsichord: [1, 0.85, 0.62, 0.55, 0.38, 0.3, 0.22, 0.18, 0.12],
  strings: [1, 0.72, 0.5, 0.42, 0.3, 0.24, 0.16, 0.12, 0.08, 0.06],
  violin: [1, 0.8, 0.62, 0.48, 0.4, 0.28, 0.2, 0.16, 0.1],
  cello: [1, 0.9, 0.55, 0.38, 0.28, 0.18, 0.12, 0.08],
  flute: [1, 0.06, 0.12, 0.02, 0.03],
  clarinet: [1, 0.02, 0.6, 0.03, 0.35, 0.02, 0.18, 0.01, 0.09],
  oboe: [1, 0.9, 0.75, 0.5, 0.45, 0.3, 0.22, 0.15, 0.1],
  sax: [1, 0.7, 0.55, 0.35, 0.3, 0.2, 0.14, 0.1],
  trumpet: [1, 0.88, 0.78, 0.62, 0.5, 0.38, 0.28, 0.2, 0.14, 0.1],
  horn: [1, 0.65, 0.35, 0.2, 0.11, 0.06, 0.03],
  guitar: [1, 0.55, 0.42, 0.22, 0.16, 0.1, 0.06, 0.04],
  harp: [1, 0.42, 0.25, 0.14, 0.09, 0.05, 0.03],
  marimba: [1, 0.05, 0.02, 0.42, 0.02, 0.01, 0.08],
  musicbox: [1, 0.02, 0.3, 0.02, 0.14, 0.01, 0.05],
  vibes: [1, 0.03, 0.35, 0.02, 0.1],
  square: [1, 0, 0.33, 0, 0.2, 0, 0.14, 0, 0.11, 0, 0.09],
  pad: [1, 0.5, 0.34, 0.25, 0.2, 0.14, 0.1, 0.08, 0.05],
  bass: [1, 0.6, 0.3, 0.16, 0.08, 0.04],
  choir: [1, 0.55, 0.7, 0.35, 0.22, 0.12, 0.08],
};

export const INSTRUMENTS: Record<InstrumentId, InstrumentPreset> = {
  piano: {
    id: 'piano', name: 'Piano', family: 'Keys', partials: P.piano,
    attack: 0.003, decay: 1.5, sustain: 0.12, release: 0.35,
    cutoff: 4200, keyTrack: 0.7, filterEnv: 1.4, filterEnvDecay: 0.28,
    noise: 0.05, noiseDecay: 0.02, gain: 0.5, range: [21, 108],
  },
  epiano: {
    id: 'epiano', name: 'Electric piano', family: 'Keys', partials: P.epiano,
    attack: 0.004, decay: 1.8, sustain: 0.16, release: 0.4,
    cutoff: 3200, keyTrack: 0.6, filterEnv: 1.1, filterEnvDecay: 0.4,
    gain: 0.5, range: [28, 103],
  },
  organ: {
    id: 'organ', name: 'Church organ', family: 'Keys', partials: P.organ,
    attack: 0.03, decay: 0.08, sustain: 0.95, release: 0.16,
    cutoff: 5000, keyTrack: 0.4, gain: 0.34, range: [24, 96],
  },
  harpsichord: {
    id: 'harpsichord', name: 'Harpsichord', family: 'Keys', partials: P.harpsichord,
    attack: 0.002, decay: 0.9, sustain: 0.04, release: 0.2,
    cutoff: 6000, keyTrack: 0.7, noise: 0.09, noiseDecay: 0.015,
    gain: 0.34, articulation: 0.85, range: [29, 89],
  },

  strings: {
    id: 'strings', name: 'Strings', family: 'Strings', partials: P.strings,
    unison: 3, detuneCents: 9,
    attack: 0.12, decay: 0.3, sustain: 0.85, release: 0.45,
    cutoff: 2600, keyTrack: 0.5, vibratoRate: 5.2, vibratoDepth: 5, vibratoDelay: 0.35,
    gain: 0.3, range: [28, 96],
  },
  violin: {
    id: 'violin', name: 'Violin', family: 'Strings', partials: P.violin,
    unison: 2, detuneCents: 5,
    attack: 0.07, decay: 0.2, sustain: 0.88, release: 0.28,
    cutoff: 3400, keyTrack: 0.6, vibratoRate: 6, vibratoDepth: 8, vibratoDelay: 0.25,
    gain: 0.28, range: [55, 100],
  },
  cello: {
    id: 'cello', name: 'Cello', family: 'Strings', partials: P.cello,
    unison: 2, detuneCents: 5,
    attack: 0.09, decay: 0.25, sustain: 0.86, release: 0.35,
    cutoff: 1900, keyTrack: 0.6, vibratoRate: 5, vibratoDepth: 7, vibratoDelay: 0.3,
    gain: 0.34, range: [36, 76],
  },
  pizz: {
    id: 'pizz', name: 'Pizzicato', family: 'Strings', partials: P.guitar,
    attack: 0.002, decay: 0.45, sustain: 0, release: 0.15,
    cutoff: 3000, keyTrack: 0.7, filterEnv: 1.2, filterEnvDecay: 0.12,
    gain: 0.42, articulation: 0.6, range: [28, 88],
  },

  flute: {
    id: 'flute', name: 'Flute', family: 'Winds', partials: P.flute,
    attack: 0.06, decay: 0.15, sustain: 0.9, release: 0.16,
    cutoff: 4200, keyTrack: 0.5, vibratoRate: 5, vibratoDepth: 6, vibratoDelay: 0.3,
    noise: 0.14, noiseDecay: 0.5, gain: 0.32, range: [60, 96],
  },
  clarinet: {
    id: 'clarinet', name: 'Clarinet', family: 'Winds', partials: P.clarinet,
    attack: 0.045, decay: 0.12, sustain: 0.92, release: 0.14,
    cutoff: 3000, keyTrack: 0.5, noise: 0.05, noiseDecay: 0.3,
    gain: 0.3, range: [50, 91],
  },
  oboe: {
    id: 'oboe', name: 'Oboe', family: 'Winds', partials: P.oboe,
    attack: 0.04, decay: 0.12, sustain: 0.9, release: 0.13,
    cutoff: 3600, keyTrack: 0.5, q: 3, vibratoRate: 5.6, vibratoDepth: 6, vibratoDelay: 0.3,
    gain: 0.24, range: [58, 91],
  },
  sax: {
    id: 'sax', name: 'Saxophone', family: 'Winds', partials: P.sax,
    attack: 0.035, decay: 0.16, sustain: 0.88, release: 0.18,
    cutoff: 2800, keyTrack: 0.5, vibratoRate: 5.4, vibratoDepth: 8, vibratoDelay: 0.28,
    noise: 0.07, noiseDecay: 0.25, gain: 0.3, range: [49, 89],
  },

  trumpet: {
    id: 'trumpet', name: 'Trumpet', family: 'Brass', partials: P.trumpet,
    attack: 0.035, decay: 0.18, sustain: 0.85, release: 0.16,
    cutoff: 2400, keyTrack: 0.6, filterEnv: 1.6, filterEnvDecay: 0.14, q: 1.4,
    gain: 0.26, range: [54, 86],
  },
  horn: {
    id: 'horn', name: 'French horn', family: 'Brass', partials: P.horn,
    attack: 0.07, decay: 0.25, sustain: 0.85, release: 0.3,
    cutoff: 1700, keyTrack: 0.55, filterEnv: 0.9, filterEnvDecay: 0.25,
    gain: 0.34, range: [41, 77],
  },

  guitar: {
    id: 'guitar', name: 'Guitar', family: 'Plucked', partials: P.guitar,
    attack: 0.002, decay: 1.1, sustain: 0.02, release: 0.3,
    cutoff: 3200, keyTrack: 0.7, filterEnv: 1.1, filterEnvDecay: 0.2,
    noise: 0.06, noiseDecay: 0.015, gain: 0.44, range: [40, 88],
  },
  harp: {
    id: 'harp', name: 'Harp', family: 'Plucked', partials: P.harp,
    attack: 0.002, decay: 1.6, sustain: 0.01, release: 0.5,
    cutoff: 4000, keyTrack: 0.7, gain: 0.44, range: [24, 103],
  },
  marimba: {
    id: 'marimba', name: 'Marimba', family: 'Tuned percussion', partials: P.marimba,
    attack: 0.001, decay: 0.5, sustain: 0, release: 0.2,
    cutoff: 5000, keyTrack: 0.6, gain: 0.5, range: [45, 96],
  },
  musicbox: {
    id: 'musicbox', name: 'Music box', family: 'Tuned percussion', partials: P.musicbox,
    attack: 0.001, decay: 0.9, sustain: 0, release: 0.6,
    cutoff: 7000, keyTrack: 0.5, gain: 0.52, range: [60, 108],
  },
  vibes: {
    id: 'vibes', name: 'Vibraphone', family: 'Tuned percussion', partials: P.vibes,
    attack: 0.002, decay: 1.6, sustain: 0.02, release: 0.8,
    cutoff: 5200, keyTrack: 0.5, vibratoRate: 4.5, vibratoDepth: 12, vibratoDelay: 0.05,
    gain: 0.46, range: [53, 89],
  },

  chiptune: {
    id: 'chiptune', name: '8-bit', family: 'Synth', partials: P.square,
    attack: 0.001, decay: 0.05, sustain: 0.7, release: 0.03,
    cutoff: 12000, keyTrack: 0.2, gain: 0.19, articulation: 0.9, range: [36, 96],
  },
  synthpad: {
    id: 'synthpad', name: 'Synth pad', family: 'Synth', partials: P.pad,
    unison: 3, detuneCents: 14,
    attack: 0.4, decay: 0.6, sustain: 0.8, release: 0.9,
    cutoff: 1800, keyTrack: 0.4, filterEnv: 1.2, filterEnvDecay: 1.2,
    gain: 0.26, range: [24, 96],
  },
  bass: {
    id: 'bass', name: 'Bass', family: 'Synth', partials: P.bass,
    attack: 0.006, decay: 0.5, sustain: 0.5, release: 0.2,
    cutoff: 1100, keyTrack: 0.5, filterEnv: 1.3, filterEnvDecay: 0.2,
    gain: 0.5, range: [24, 60],
  },

  // A wordless 'ahh' — the closest this gets to a voice.
  choir: {
    id: 'choir', name: 'Choir (ahh)', family: 'Voice', partials: P.choir,
    unison: 3, detuneCents: 11,
    attack: 0.14, decay: 0.3, sustain: 0.85, release: 0.5,
    cutoff: 2200, keyTrack: 0.4, q: 2, vibratoRate: 4.8, vibratoDepth: 7, vibratoDelay: 0.4,
    noise: 0.05, noiseDecay: 0.6, gain: 0.3, range: [40, 84],
  },
};

export const INSTRUMENT_LIST = Object.values(INSTRUMENTS);

/** Grouped for the instrument picker. */
export function instrumentsByFamily(): Array<[string, InstrumentPreset[]]> {
  const groups = new Map<string, InstrumentPreset[]>();
  for (const p of INSTRUMENT_LIST) {
    if (!groups.has(p.family)) groups.set(p.family, []);
    groups.get(p.family)!.push(p);
  }
  return Array.from(groups.entries());
}

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

/** Compile partial amplitudes into a PeriodicWave, cached per context. */
export function periodicWave(ctx: BaseAudioContext, partials: number[]): PeriodicWave {
  let perCtx = waveCache.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    waveCache.set(ctx, perCtx);
  }
  const key = partials.join(',');
  const hit = perCtx.get(key);
  if (hit) return hit;

  const n = partials.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 0; i < partials.length; i++) imag[i + 1] = partials[i];
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  perCtx.set(key, wave);
  return wave;
}

let sharedNoise: AudioBuffer | null = null;
let noiseCtx: BaseAudioContext | null = null;

/** One second of white noise, reused for every breath and hammer transient. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (sharedNoise && noiseCtx === ctx) return sharedNoise;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  sharedNoise = buf;
  noiseCtx = ctx;
  return buf;
}
