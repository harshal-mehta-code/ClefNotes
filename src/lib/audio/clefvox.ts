/**
 * ClefVox — a formant singing synthesiser.
 *
 * Cloud TTS can't hold a pitch, costs money per note, and needs a network. So
 * ClefNotes sings the old-fashioned way: a glottal pulse train at the note's
 * frequency, pushed through three parallel bandpass filters parked on the
 * formant frequencies of whatever vowel the syllable contains.
 *
 * That's genuinely how vowels work — the vocal tract is a filter, not a source —
 * so the result is recognisably the right word. It sounds like a friendly robot
 * choir, which is exactly what a rehearsal track should sound like.
 */

export interface Formant {
  /** F1, F2, F3 in Hz. */
  f: [number, number, number];
  /** Relative amplitude of each formant. */
  a: [number, number, number];
  /** Bandwidths in Hz. */
  bw: [number, number, number];
}

/**
 * Peterson & Barney formant values for English vowels, neutral adult voice.
 * Keyed by IPA symbol.
 */
export const VOWELS: Record<string, Formant> = {
  i:  { f: [270, 2290, 3010], a: [1, 0.36, 0.16], bw: [60, 110, 160] },  // beat
  ɪ:  { f: [390, 1990, 2550], a: [1, 0.4, 0.2],   bw: [65, 115, 165] },  // bit
  e:  { f: [400, 2100, 2600], a: [1, 0.42, 0.2],  bw: [65, 115, 165] },  // bait
  ɛ:  { f: [530, 1840, 2480], a: [1, 0.48, 0.22], bw: [70, 120, 170] },  // bet
  æ:  { f: [660, 1720, 2410], a: [1, 0.52, 0.24], bw: [75, 125, 175] },  // bat
  ɑ:  { f: [730, 1090, 2440], a: [1, 0.6, 0.2],   bw: [80, 90, 180] },   // father
  ɔ:  { f: [570, 840, 2410],  a: [1, 0.5, 0.14],  bw: [70, 80, 175] },   // bought
  o:  { f: [490, 910, 2450],  a: [1, 0.42, 0.12], bw: [65, 80, 175] },   // boat
  ʊ:  { f: [440, 1020, 2240], a: [1, 0.36, 0.1],  bw: [65, 85, 170] },   // book
  u:  { f: [300, 870, 2240],  a: [1, 0.28, 0.08], bw: [60, 80, 170] },   // boot
  ʌ:  { f: [640, 1190, 2390], a: [1, 0.55, 0.2],  bw: [75, 95, 175] },   // but
  ɝ:  { f: [490, 1350, 1690], a: [1, 0.6, 0.45],  bw: [70, 100, 120] },  // bird
  ə:  { f: [500, 1500, 2500], a: [1, 0.5, 0.2],   bw: [70, 110, 175] },  // about
  m:  { f: [280, 900, 2200],  a: [1, 0.12, 0.04], bw: [90, 130, 200] },  // nasal hum
};

/** Diphthongs glide from one vowel to another across the note. */
const DIPHTHONGS: Record<string, [string, string]> = {
  aɪ: ['ɑ', 'ɪ'],
  aʊ: ['ɑ', 'ʊ'],
  ɔɪ: ['ɔ', 'ɪ'],
  eɪ: ['ɛ', 'ɪ'],
  oʊ: ['o', 'ʊ'],
};

export type ConsonantKind = 'none' | 'plosive' | 'fricative' | 'nasal' | 'liquid' | 'glide' | 'sibilant';

export interface Phonetics {
  /** IPA vowel key, or a diphthong key. */
  vowel: string;
  onset: ConsonantKind;
  /** Voiced onsets (b, d, g, m, n, v, z) start with pitch already present. */
  onsetVoiced: boolean;
  coda: ConsonantKind;
}

/**
 * English spelling → vowel, by rule.
 *
 * English orthography is famously irregular, so this is a heuristic, not a
 * lexicon. It gets the common cases right, and a wrong vowel costs a slightly
 * odd-sounding syllable rather than a wrong note — an acceptable failure.
 */
export function phonetics(rawSyllable: string): Phonetics {
  const s = rawSyllable.toLowerCase().replace(/[^a-z']/g, '');
  if (!s) return { vowel: 'ɑ', onset: 'none', onsetVoiced: true, coda: 'none' };

  const firstVowel = s.search(/[aeiouy]/);
  const onsetStr = firstVowel > 0 ? s.slice(0, firstVowel) : '';
  const rest = firstVowel >= 0 ? s.slice(firstVowel) : s;
  const vowelMatch = /^[aeiouy]+/.exec(rest);
  const vowelStr = vowelMatch ? vowelMatch[0] : 'a';
  const codaStr = rest.slice(vowelStr.length);

  let vowel = 'ʌ';

  // Multi-letter vowel clusters first — they are the reliable ones.
  const cluster = vowelStr + (codaStr.startsWith('r') ? 'r' : '');
  const CLUSTERS: Array<[RegExp, string]> = [
    [/^(ee|ea|ie)$/, 'i'],
    [/^(oo)$/, 'u'],
    [/^(ou|ow)$/, 'aʊ'],
    [/^(ai|ay|ae)$/, 'eɪ'],
    [/^(oa|oe)$/, 'oʊ'],
    [/^(oi|oy)$/, 'ɔɪ'],
    [/^(au|aw)$/, 'ɔ'],
    [/^(eu|ew)$/, 'u'],
    [/^(ei|ey)$/, 'eɪ'],
    [/^(ar)$/, 'ɑ'],
    [/^(er|ir|ur|yr)$/, 'ɝ'],
    [/^(or)$/, 'ɔ'],
  ];
  let matched = false;
  for (const [re, v] of CLUSTERS) {
    if (re.test(cluster) || re.test(vowelStr)) {
      vowel = v;
      matched = true;
      break;
    }
  }

  if (!matched) {
    // Silent-e makes the preceding vowel "long": time, home, made.
    const silentE = /^[^aeiou]*e$/.test(codaStr) && codaStr.length > 1;
    const single = vowelStr[0];
    if (silentE) {
      vowel = { a: 'eɪ', e: 'i', i: 'aɪ', o: 'oʊ', u: 'u', y: 'aɪ' }[single] ?? 'ʌ';
    } else {
      vowel = { a: 'æ', e: 'ɛ', i: 'ɪ', o: 'ɑ', u: 'ʌ', y: 'ɪ' }[single] ?? 'ʌ';
    }
    // A lone final 'y' or unstressed ending reads as a short i / schwa.
    if (single === 'y' && vowelStr === 'y' && !codaStr) vowel = 'i';
  }

  return {
    vowel,
    onset: classifyConsonant(onsetStr),
    onsetVoiced: !/^[ptkfsh]|^(sh|th|ch)/.test(onsetStr),
    coda: classifyConsonant(codaStr),
  };
}

function classifyConsonant(c: string): ConsonantKind {
  if (!c) return 'none';
  if (/^(s|z|sh|ch|x|ts)/.test(c)) return 'sibilant';
  if (/^(p|t|k|b|d|g|c|q|j)/.test(c)) return 'plosive';
  if (/^(f|v|th|h|gh|ph)/.test(c)) return 'fricative';
  if (/^(m|n|ng)/.test(c)) return 'nasal';
  if (/^(l|r)/.test(c)) return 'liquid';
  if (/^(w|y)/.test(c)) return 'glide';
  return 'fricative';
}

export type VoiceTypeId = 'soprano' | 'alto' | 'tenor' | 'bass' | 'choir' | 'robot' | 'child';

export interface VoicePreset {
  id: VoiceTypeId;
  name: string;
  /** Formant frequencies scale with vocal-tract length. */
  formantScale: number;
  vibratoRate: number;
  /** Vibrato depth in cents. */
  vibratoDepth: number;
  vibratoDelay: number;
  /** Breath noise level, 0-1. */
  breath: number;
  /** Unison voices — a section rather than a soloist. */
  unison: number;
  /** Detune spread in cents across the unison. */
  spread: number;
  /** Glottal source brightness: more partials = more edge. */
  brightness: number;
  gain: number;
}

export const VOICE_PRESETS: Record<VoiceTypeId, VoicePreset> = {
  soprano: {
    id: 'soprano', name: 'Soprano', formantScale: 1.18, vibratoRate: 5.6, vibratoDepth: 34,
    vibratoDelay: 0.28, breath: 0.1, unison: 1, spread: 0, brightness: 0.72, gain: 0.5,
  },
  alto: {
    id: 'alto', name: 'Alto', formantScale: 1.09, vibratoRate: 5.2, vibratoDepth: 28,
    vibratoDelay: 0.3, breath: 0.11, unison: 1, spread: 0, brightness: 0.66, gain: 0.52,
  },
  tenor: {
    id: 'tenor', name: 'Tenor', formantScale: 1.0, vibratoRate: 5.0, vibratoDepth: 26,
    vibratoDelay: 0.3, breath: 0.12, unison: 1, spread: 0, brightness: 0.7, gain: 0.54,
  },
  bass: {
    id: 'bass', name: 'Bass', formantScale: 0.9, vibratoRate: 4.6, vibratoDepth: 22,
    vibratoDelay: 0.34, breath: 0.13, unison: 1, spread: 0, brightness: 0.74, gain: 0.58,
  },
  choir: {
    id: 'choir', name: 'Choir (×6)', formantScale: 1.04, vibratoRate: 4.8, vibratoDepth: 24,
    vibratoDelay: 0.32, breath: 0.16, unison: 6, spread: 16, brightness: 0.6, gain: 0.34,
  },
  child: {
    id: 'child', name: 'Children', formantScale: 1.3, vibratoRate: 5.4, vibratoDepth: 18,
    vibratoDelay: 0.35, breath: 0.14, unison: 3, spread: 10, brightness: 0.5, gain: 0.42,
  },
  robot: {
    id: 'robot', name: 'Robot', formantScale: 1.0, vibratoRate: 0, vibratoDepth: 0,
    vibratoDelay: 0, breath: 0.02, unison: 1, spread: 0, brightness: 1, gain: 0.5,
  },
};

/** Pick a voice type from a part's tessitura. */
export function suggestVoice(medianMidi: number): VoiceTypeId {
  if (medianMidi >= 67) return 'soprano';
  if (medianMidi >= 60) return 'alto';
  if (medianMidi >= 50) return 'tenor';
  return 'bass';
}

let glottalWave: PeriodicWave | null = null;
let glottalCtx: BaseAudioContext | null = null;
let glottalBrightness = -1;

/**
 * The glottal source: a pulse train whose harmonics roll off at roughly
 * -12 dB/octave, which is what real vocal folds produce.
 */
function glottalSource(ctx: BaseAudioContext, brightness: number): PeriodicWave {
  if (glottalWave && glottalCtx === ctx && glottalBrightness === brightness) return glottalWave;
  const n = 40;
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  for (let h = 1; h <= n; h++) {
    imag[h] = Math.pow(h, -1 - (1 - brightness) * 1.4) * (1 / h) * h;
  }
  glottalWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  glottalCtx = ctx;
  glottalBrightness = brightness;
  return glottalWave;
}

let vowelNoise: AudioBuffer | null = null;
let vowelNoiseCtx: BaseAudioContext | null = null;

function breathNoise(ctx: BaseAudioContext): AudioBuffer {
  if (vowelNoise && vowelNoiseCtx === ctx) return vowelNoise;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  vowelNoise = buf;
  vowelNoiseCtx = ctx;
  return buf;
}

export interface SingOptions {
  freq: number;
  when: number;
  duration: number;
  syllable?: string;
  /** Slide into this frequency at the end — legato between slurred notes. */
  glideTo?: number;
  preset: VoicePreset;
  velocity?: number;
}

/**
 * Sing one note. Returns the nodes so the caller can stop them early.
 */
export function sing(
  ctx: BaseAudioContext,
  dest: AudioNode,
  opts: SingOptions,
): AudioScheduledSourceNode[] {
  const { freq, when, duration, preset, velocity = 1 } = opts;
  const ph = phonetics(opts.syllable ?? 'ah');
  const started: AudioScheduledSourceNode[] = [];

  // Resolve the vowel (or the two ends of a diphthong) and scale the formants
  // for this voice type.
  const glide = DIPHTHONGS[ph.vowel];
  const startVowel = VOWELS[glide ? glide[0] : ph.vowel] ?? VOWELS['ʌ'];
  const endVowel = VOWELS[glide ? glide[1] : ph.vowel] ?? startVowel;
  const scale = preset.formantScale;

  // Consonant timings. A plosive delays the vowel; a sibilant precedes it.
  const onsetLen =
    ph.onset === 'plosive' ? 0.045 :
    ph.onset === 'sibilant' ? 0.09 :
    ph.onset === 'fricative' ? 0.07 :
    ph.onset === 'nasal' ? 0.06 :
    ph.onset === 'liquid' || ph.onset === 'glide' ? 0.05 : 0;

  const vowelStart = when + onsetLen;
  const vowelEnd = when + Math.max(duration * 0.92, duration - 0.06);
  const sustainLen = Math.max(0.05, vowelEnd - vowelStart);

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0;
  voiceGain.connect(dest);

  const unison = Math.max(1, preset.unison);
  for (let u = 0; u < unison; u++) {
    // Each choir member is slightly off in pitch and slightly late — that
    // scatter is most of what makes a section sound like people.
    const detune = unison === 1 ? 0 : (u - (unison - 1) / 2) * preset.spread + (Math.random() - 0.5) * 6;
    const jitter = unison === 1 ? 0 : Math.random() * 0.028;

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(glottalSource(ctx, preset.brightness));
    osc.frequency.setValueAtTime(freq, when);
    osc.detune.value = detune;
    if (opts.glideTo && opts.glideTo !== freq) {
      osc.frequency.setValueAtTime(freq, vowelEnd - Math.min(0.12, sustainLen * 0.4));
      osc.frequency.linearRampToValueAtTime(opts.glideTo, vowelEnd);
    }

    // Vibrato, delayed — singers don't start a note with it.
    if (preset.vibratoDepth > 0 && duration > preset.vibratoDelay + 0.1) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = preset.vibratoRate + (Math.random() - 0.5) * 0.4;
      lfoGain.gain.setValueAtTime(0, when);
      lfoGain.gain.setValueAtTime(0, when + preset.vibratoDelay);
      lfoGain.gain.linearRampToValueAtTime(preset.vibratoDepth, when + preset.vibratoDelay + 0.25);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);
      lfo.start(when);
      lfo.stop(vowelEnd + 0.3);
      started.push(lfo);
    }

    const sourceGain = ctx.createGain();
    sourceGain.gain.value = 1 / Math.sqrt(unison);
    osc.connect(sourceGain);

    // Three parallel formant resonators. This is the vowel.
    for (let i = 0; i < 3; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const f0 = startVowel.f[i] * scale;
      const f1 = endVowel.f[i] * scale;
      bp.frequency.setValueAtTime(f0, when);
      if (glide) {
        // Diphthongs move: "night" travels from ɑ to ɪ across the note.
        bp.frequency.setValueAtTime(f0, vowelStart + sustainLen * 0.45);
        bp.frequency.linearRampToValueAtTime(f1, vowelEnd);
      }
      bp.Q.value = Math.max(1.5, startVowel.f[i] / startVowel.bw[i]);

      const fg = ctx.createGain();
      fg.gain.value = startVowel.a[i];
      sourceGain.connect(bp);
      bp.connect(fg);
      fg.connect(voiceGain);
    }

    // A little unfiltered source keeps low notes from disappearing.
    const bypass = ctx.createGain();
    bypass.gain.value = 0.06;
    sourceGain.connect(bypass);
    bypass.connect(voiceGain);

    osc.start(when + jitter);
    osc.stop(vowelEnd + 0.35);
    started.push(osc);
  }

  // Amplitude envelope, shaped by the onset consonant.
  const peak = 0.9 * velocity * preset.gain;
  const attack = ph.onset === 'plosive' ? 0.012 : ph.onset === 'none' ? 0.05 : 0.03;
  voiceGain.gain.setValueAtTime(0.0001, when);
  if (onsetLen > 0 && !ph.onsetVoiced) {
    // Unvoiced onset: hold the pitch back until the burst is over.
    voiceGain.gain.setValueAtTime(0.0001, vowelStart - 0.005);
  }
  voiceGain.gain.linearRampToValueAtTime(peak, vowelStart + attack);
  voiceGain.gain.setValueAtTime(peak, Math.max(vowelStart + attack + 0.001, vowelEnd - 0.08));
  voiceGain.gain.exponentialRampToValueAtTime(0.0001, vowelEnd + 0.12);

  // Consonant noise: the burst or hiss that makes the word intelligible.
  if (ph.onset !== 'none' && ph.onset !== 'liquid' && ph.onset !== 'glide') {
    const src = ctx.createBufferSource();
    src.buffer = breathNoise(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value =
      ph.onset === 'sibilant' ? 6200 : ph.onset === 'plosive' ? 2400 : ph.onset === 'nasal' ? 700 : 3600;
    bp.Q.value = ph.onset === 'sibilant' ? 1.4 : 0.9;
    const g = ctx.createGain();
    const noisePeak = (ph.onset === 'sibilant' ? 0.16 : ph.onset === 'plosive' ? 0.2 : 0.11) * velocity;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(noisePeak, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + onsetLen + 0.02);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(when);
    src.stop(when + onsetLen + 0.08);
    started.push(src);
  }

  // Closing consonant, so "night" ends rather than just stops.
  if (ph.coda === 'sibilant' || ph.coda === 'plosive' || ph.coda === 'fricative') {
    const src = ctx.createBufferSource();
    src.buffer = breathNoise(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = ph.coda === 'sibilant' ? 6800 : 2800;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, vowelEnd);
    g.gain.linearRampToValueAtTime(0.1 * velocity, vowelEnd + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, vowelEnd + 0.1);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(vowelEnd);
    src.stop(vowelEnd + 0.16);
    started.push(src);
  }

  // Continuous breath under the tone.
  if (preset.breath > 0.02) {
    const src = ctx.createBufferSource();
    src.buffer = breathNoise(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = startVowel.f[1] * scale;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(preset.breath * 0.13 * velocity, vowelStart + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, vowelEnd + 0.08);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(when);
    src.stop(vowelEnd + 0.12);
    started.push(src);
  }

  return started;
}

/** Human-readable IPA for the karaoke bar's vowel chips. */
export function vowelLabel(syllable: string): string {
  return phonetics(syllable).vowel;
}
