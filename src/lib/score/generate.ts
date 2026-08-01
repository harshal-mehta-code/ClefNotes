import { buildMusicXml, type ScoreSpec } from './builder';

/**
 * The sight-reading generator.
 *
 * A daily phrase you have provably never seen is the one exercise an imported
 * library can't provide, and it's the reason to open the app on a day you
 * weren't going to practise. Everyone gets the same phrase on the same date, so
 * scores are comparable.
 */

/** Deterministic PRNG so a given seed always yields the same phrase. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromDate(d = new Date()): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export interface Grade {
  level: number;
  name: string;
  /** Scale degrees allowed, relative to the tonic. */
  degrees: number[];
  /** Largest leap in scale steps. */
  maxLeap: number;
  /** Rhythm cells, each summing to one beat or more, in quarter notes. */
  rhythms: number[][];
  bars: number;
  keys: number[];
  meters: Array<[number, number]>;
}

export const GRADES: Grade[] = [
  {
    level: 1, name: 'First steps',
    degrees: [0, 1, 2, 3, 4], maxLeap: 2,
    rhythms: [[1], [1], [2], [1, 1], [2]],
    bars: 4, keys: [0], meters: [[4, 4]],
  },
  {
    level: 2, name: 'Steady',
    degrees: [0, 1, 2, 3, 4, 5, 6, 7], maxLeap: 3,
    rhythms: [[1], [2], [1, 1], [0.5, 0.5], [1.5, 0.5]],
    bars: 4, keys: [0, 1, -1], meters: [[4, 4], [3, 4]],
  },
  {
    level: 3, name: 'Moving',
    degrees: [0, 1, 2, 3, 4, 5, 6, 7], maxLeap: 4,
    rhythms: [[1], [0.5, 0.5], [1.5, 0.5], [0.5, 0.25, 0.25], [2], [0.75, 0.25]],
    bars: 8, keys: [0, 1, -1, 2, -2], meters: [[4, 4], [3, 4], [2, 4]],
  },
  {
    level: 4, name: 'Confident',
    degrees: [-3, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9], maxLeap: 5,
    rhythms: [[1], [0.5, 0.5], [1.5, 0.5], [0.25, 0.25, 0.5], [0.5, 0.25, 0.25], [2], [3]],
    bars: 8, keys: [0, 1, -1, 2, -2, 3, -3], meters: [[4, 4], [3, 4], [6, 8]],
  },
  {
    level: 5, name: 'Fluent',
    degrees: [-5, -3, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11], maxLeap: 7,
    rhythms: [[1], [0.5, 0.5], [0.25, 0.25, 0.25, 0.25], [1.5, 0.5], [0.5, 0.25, 0.25], [0.75, 0.25], [2]],
    bars: 8, keys: [0, 1, -1, 2, -2, 3, -3, 4, -4], meters: [[4, 4], [3, 4], [6, 8], [2, 2]],
  },
];

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Tonic letter and its MIDI pitch class for a given key signature. */
function tonicOf(fifths: number): { letter: number; semitone: number } {
  // Circle of fifths: each step up is a fifth (7 semitones, 4 letters).
  const letter = ((fifths * 4) % 7 + 7) % 7;
  const semitone = ((fifths * 7) % 12 + 12) % 12;
  return { letter, semitone };
}

function noteToken(degree: number, fifths: number, baseOctave: number): string {
  const tonic = tonicOf(fifths);
  const idx = ((degree % 7) + 7) % 7;
  const octaveShift = Math.floor(degree / 7);
  const letterIndex = (tonic.letter + idx) % 7;
  const letter = LETTERS[letterIndex];

  // Work out the accidental this key signature applies to that letter.
  const naturalPc = [0, 2, 4, 5, 7, 9, 11][letterIndex];
  const wantedPc = (tonic.semitone + MAJOR_STEPS[idx]) % 12;
  let alter = wantedPc - naturalPc;
  if (alter > 6) alter -= 12;
  if (alter < -6) alter += 12;

  // Octave: letters wrap at C, so crossing C bumps the octave.
  const letterWrap = tonic.letter + idx >= 7 ? 1 : 0;
  const octave = baseOctave + octaveShift + letterWrap;

  const accidental = alter === 1 ? '#' : alter === -1 ? 'b' : '';
  return `${letter}${accidental}${octave}`;
}

const DUR_CODE: Array<[number, string]> = [
  [4, 'w'], [3, 'h.'], [2, 'h'], [1.5, 'q.'], [1, 'q'], [0.75, 'e.'], [0.5, 'e'], [0.25, 's'],
];

function durToken(q: number): string {
  let best = DUR_CODE[DUR_CODE.length - 1];
  for (const entry of DUR_CODE) {
    if (Math.abs(entry[0] - q) < Math.abs(best[0] - q)) best = entry;
  }
  return best[1];
}

export interface GeneratedPhrase {
  musicXml: string;
  gradeName: string;
  keyName: string;
  bpm: number;
}

const KEY_NAMES: Record<number, string> = {
  0: 'C major', 1: 'G major', 2: 'D major', 3: 'A major', 4: 'E major',
  '-1': 'F major', '-2': 'B♭ major', '-3': 'E♭ major', '-4': 'A♭ major',
};

export function generatePhrase(level: number, seed: number, clef: 'G2' | 'F4' = 'G2'): GeneratedPhrase {
  const grade = GRADES[Math.max(0, Math.min(GRADES.length - 1, level - 1))];
  const rnd = mulberry32(seed * 7919 + level * 104729);

  const fifths = grade.keys[Math.floor(rnd() * grade.keys.length)];
  const meter = grade.meters[Math.floor(rnd() * grade.meters.length)];
  const qPerBar = (meter[0] * 4) / meter[1];
  const baseOctave = clef === 'F4' ? 3 : 4;

  const tokens: string[] = [];
  let degree = 0;

  for (let bar = 0; bar < grade.bars; bar++) {
    let filled = 0;
    let guard = 0;
    while (filled < qPerBar - 1e-9 && guard++ < 32) {
      const cell = grade.rhythms[Math.floor(rnd() * grade.rhythms.length)];
      const cellLen = cell.reduce((a, b) => a + b, 0);
      if (filled + cellLen > qPerBar + 1e-9) {
        // Fill the remainder with a single value rather than overflowing.
        const rest = qPerBar - filled;
        tokens.push(`${noteToken(degree, fifths, baseOctave)}:${durToken(rest)}`);
        filled = qPerBar;
        break;
      }
      for (const d of cell) {
        // Step or leap, favouring steps and pulling back toward the middle.
        const leap = rnd() < 0.22 ? Math.floor(rnd() * grade.maxLeap) + 2 : 1;
        const dir = degree > 6 ? -1 : degree < -2 ? 1 : rnd() < 0.5 ? -1 : 1;
        let next = degree + dir * leap;
        const allowed = grade.degrees;
        if (!allowed.includes(next)) {
          next = allowed[Math.floor(rnd() * allowed.length)];
        }
        degree = next;
        tokens.push(`${noteToken(degree, fifths, baseOctave)}:${durToken(d)}`);
        filled += d;
      }
    }
    // Land on the tonic at the end — phrases should sound finished.
    if (bar === grade.bars - 1) {
      tokens.splice(tokens.length - 1, 1, `${noteToken(0, fifths, baseOctave)}:${durToken(qPerBar >= 3 ? qPerBar : 2)}`);
    }
  }

  const bpm = 66 + Math.floor(rnd() * 34);
  const spec: ScoreSpec = {
    title: `Sight-reading · Grade ${grade.level}`,
    composer: `${grade.name} · ${KEY_NAMES[fifths] ?? 'C major'}`,
    fifths,
    time: meter,
    bpm,
    parts: [{ name: 'Sight-reading', abbrev: 'SR', clef, notes: tokens.join(' ') }],
  };

  return {
    musicXml: buildMusicXml(spec),
    gradeName: grade.name,
    keyName: KEY_NAMES[fifths] ?? 'C major',
    bpm,
  };
}

/** Scales and arpeggios for warm-ups — dull, and genuinely useful. */
export function generateWarmup(fifths: number, clef: 'G2' | 'F4' = 'G2'): string {
  const base = clef === 'F4' ? 3 : 4;
  const up = [0, 1, 2, 3, 4, 5, 6, 7];
  const down = [6, 5, 4, 3, 2, 1, 0];
  const arp = [0, 2, 4, 7, 4, 2, 0];
  const scale = [...up, ...down].map((d) => `${noteToken(d, fifths, base)}:e`);
  const arpeggio = arp.map((d) => `${noteToken(d, fifths, base)}:q`);
  return buildMusicXml({
    title: `Warm-up · ${KEY_NAMES[fifths] ?? 'C major'}`,
    composer: 'Scale and arpeggio',
    fifths,
    time: [4, 4],
    bpm: 84,
    parts: [{ name: 'Warm-up', abbrev: 'WU', clef, notes: [...scale, ...arpeggio].join(' ') }],
  });
}
