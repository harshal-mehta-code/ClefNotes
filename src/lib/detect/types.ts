/**
 * What ClefNotes reads off a page.
 *
 * Deliberately small. Earlier versions tried to reconstruct a *score* —
 * durations, voices, bars — and re-engrave it, and that reconstruction is where
 * every serious error came from: rhythm is the least reliable thing to read off
 * a page, and getting it wrong makes the result sound like different music.
 *
 * So nothing here describes time. A note is a position on a page and a pitch,
 * and pitch comes from staff-line geometry, which is the one thing this can do
 * reliably. You keep looking at your own sheet music; the app just makes it
 * audible.
 */

export type ClefId = 'treble' | 'bass' | 'treble8' | 'alto';

export const CLEFS: Array<{ id: ClefId; label: string; short: string }> = [
  { id: 'treble', label: 'Treble', short: 'G' },
  { id: 'bass', label: 'Bass', short: 'F' },
  { id: 'treble8', label: 'Treble 8vb', short: 'G8' },
  { id: 'alto', label: 'Alto', short: 'C' },
];

/**
 * Diatonic index of the pitch sitting on the bottom line of the staff.
 * Index counts letters from C0, so C4 (middle C) is 4*7 = 28.
 */
const BOTTOM_LINE: Record<ClefId, number> = {
  treble: 4 * 7 + 2, // E4
  bass: 2 * 7 + 4, // G2
  treble8: 3 * 7 + 2, // E3 — sounds an octave below treble
  alto: 3 * 7 + 3, // F3
};

const LETTER_SEMITONE = [0, 2, 4, 5, 7, 9, 11];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Whether an accidental printed beside the note applies, and what it does.
 * `null` means nothing is printed there, so the key signature decides.
 */
export type Alter = -1 | 0 | 1 | null;

/**
 * A staff step (0 = bottom line, +1 per half-space upward) to a MIDI pitch.
 *
 * An accidental printed on the page overrides the key signature rather than
 * adding to it — that is the whole point of one. A natural beside a B in E♭
 * major means B natural, not B double-flat.
 */
export function stepToMidi(step: number, clef: ClefId, sharps = 0, alter: Alter = null): number {
  const index = BOTTOM_LINE[clef] + step;
  const octave = Math.floor(index / 7);
  const letter = ((index % 7) + 7) % 7;
  return (octave + 1) * 12 + LETTER_SEMITONE[letter] + (alter ?? keyAlteration(letter, sharps));
}

export function stepToName(step: number, clef: ClefId, sharps = 0, alter: Alter = null): string {
  const index = BOTTOM_LINE[clef] + step;
  const octave = Math.floor(index / 7);
  const letter = ((index % 7) + 7) % 7;
  const applied = alter ?? keyAlteration(letter, sharps);
  const mark = applied === 1 ? '♯' : applied === -1 ? '♭' : '';
  return `${LETTERS[letter]}${mark}${octave - 1}`;
}

/** Order the sharps and flats appear in a key signature. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

function keyAlteration(letter: number, sharps: number): number {
  if (sharps > 0) return SHARP_ORDER.slice(0, Math.min(7, sharps)).includes(letter) ? 1 : 0;
  if (sharps < 0) return FLAT_ORDER.slice(0, Math.min(7, -sharps)).includes(letter) ? -1 : 0;
  return 0;
}

export interface DetectedStaff {
  id: string;
  page: number;
  /** Index of this staff on its page, top to bottom. */
  index: number;
  /** Which braced system it belongs to. */
  system: number;
  /** Position within that system, which is what makes it "the tenor staff". */
  positionInSystem: number;
  /** Y of the five lines, in image pixels. */
  lines: number[];
  spacing: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  clef: ClefId;
  /**
   * Key signature read at the head of this staff, in sharps (negative for
   * flats). Null means it could not be read with confidence — the score's key
   * is used instead. It is per staff because music changes key: one global
   * setting gets a modulation wrong for every note after it.
   */
  sharps: number | null;
}

/** The keys a score can be in, in the order a musician thinks of them. */
export const KEYS: Array<{ sharps: number; label: string; short: string }> = [
  { sharps: 0, label: 'C major / A minor', short: '♮' },
  { sharps: 1, label: 'G major / E minor', short: '1♯' },
  { sharps: 2, label: 'D major / B minor', short: '2♯' },
  { sharps: 3, label: 'A major / F♯ minor', short: '3♯' },
  { sharps: 4, label: 'E major / C♯ minor', short: '4♯' },
  { sharps: 5, label: 'B major / G♯ minor', short: '5♯' },
  { sharps: 6, label: 'F♯ major / D♯ minor', short: '6♯' },
  { sharps: -1, label: 'F major / D minor', short: '1♭' },
  { sharps: -2, label: 'B♭ major / G minor', short: '2♭' },
  { sharps: -3, label: 'E♭ major / C minor', short: '3♭' },
  { sharps: -4, label: 'A♭ major / F minor', short: '4♭' },
  { sharps: -5, label: 'D♭ major / B♭ minor', short: '5♭' },
  { sharps: -6, label: 'G♭ major / E♭ minor', short: '6♭' },
];

export const keyLabel = (sharps: number): string =>
  KEYS.find((k) => k.sharps === sharps)?.label ?? `${sharps} sharps`;
export const keyShort = (sharps: number): string =>
  KEYS.find((k) => k.sharps === sharps)?.short ?? `${sharps}`;

export interface DetectedNote {
  id: string;
  page: number;
  staff: string;
  /** Centre of the notehead, in image pixels. */
  x: number;
  y: number;
  /** Half-spaces above the bottom staff line. */
  step: number;
  /** True for a solid notehead; hollow ones are minims and semibreves. */
  filled: boolean;
  /**
   * A sharp, natural or flat printed immediately before this notehead, if one
   * was found. Null means none was, and the key signature applies.
   */
  accidental: Alter;
}

export interface ScorePage {
  index: number;
  /** The rendered page, exactly as printed. This is what the user looks at. */
  image: string;
  width: number;
  height: number;
}

export interface PageScore {
  id: string;
  title: string;
  addedAt: number;
  openedAt: number;
  pages: ScorePage[];
  staves: DetectedStaff[];
  notes: DetectedNote[];
  /** Key signature in sharps (negative for flats), set by the user. */
  sharps: number;
  /** Pitch corrections, keyed by note id: half-steps of staff position. */
  nudges: Record<string, number>;
  /**
   * Accidentals the user has set, keyed by note id, overriding whatever was
   * read off the page. A stored `null` is a real answer — "nothing is printed
   * beside this note" — which is why absence from the record is what means
   * "nobody has said", and the two cannot be collapsed.
   */
  alters: Record<string, Alter>;
}

/** The key in force on a staff: what was read there, or the score's default. */
export function staffSharps(staff: DetectedStaff, score: PageScore): number {
  return staff.sharps ?? score.sharps;
}

/** The accidental in force on a note: what the user said, else what was read. */
export function noteAlter(note: DetectedNote, score: PageScore): Alter {
  const alters = score.alters ?? {};
  return note.id in alters ? alters[note.id] : (note.accidental ?? null);
}

/** The sounding pitch of a note, including any correction the user has made. */
export function noteMidi(note: DetectedNote, staff: DetectedStaff, score: PageScore): number {
  return stepToMidi(
    note.step + (score.nudges[note.id] ?? 0),
    staff.clef,
    staffSharps(staff, score),
    noteAlter(note, score),
  );
}

export function noteName(note: DetectedNote, staff: DetectedStaff, score: PageScore): string {
  return stepToName(
    note.step + (score.nudges[note.id] ?? 0),
    staff.clef,
    staffSharps(staff, score),
    noteAlter(note, score),
  );
}

/** The staff step at an arbitrary y — what makes clicking bare staff work. */
export function stepAt(staff: DetectedStaff, y: number): number {
  return Math.round((staff.lines[4] - y) / (staff.spacing / 2));
}
