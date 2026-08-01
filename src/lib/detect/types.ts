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

/** A staff step (0 = bottom line, +1 per half-space upward) to a MIDI pitch. */
export function stepToMidi(step: number, clef: ClefId, sharps = 0): number {
  const index = BOTTOM_LINE[clef] + step;
  const octave = Math.floor(index / 7);
  const letter = ((index % 7) + 7) % 7;
  let midi = (octave + 1) * 12 + LETTER_SEMITONE[letter];
  // The key signature raises or lowers particular letters everywhere.
  midi += keyAlteration(letter, sharps);
  return midi;
}

export function stepToName(step: number, clef: ClefId, sharps = 0): string {
  const index = BOTTOM_LINE[clef] + step;
  const octave = Math.floor(index / 7);
  const letter = ((index % 7) + 7) % 7;
  const alter = keyAlteration(letter, sharps);
  const mark = alter === 1 ? '♯' : alter === -1 ? '♭' : '';
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
}

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
}

/** The sounding pitch of a note, including any correction the user has made. */
export function noteMidi(note: DetectedNote, staff: DetectedStaff, score: PageScore): number {
  return stepToMidi(note.step + (score.nudges[note.id] ?? 0), staff.clef, score.sharps);
}

export function noteName(note: DetectedNote, staff: DetectedStaff, score: PageScore): string {
  return stepToName(note.step + (score.nudges[note.id] ?? 0), staff.clef, score.sharps);
}

/** The staff step at an arbitrary y — what makes clicking bare staff work. */
export function stepAt(staff: DetectedStaff, y: number): number {
  return Math.round((staff.lines[4] - y) / (staff.spacing / 2));
}
