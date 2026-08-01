/**
 * The playback model.
 *
 * Everything here is derived from Verovio's timemap rather than parsed
 * separately, so the picture and the sound can never disagree — the note that
 * lights up is by construction the note that sounds.
 */

/** Riso inks, cycled one per part. Index into PART_INKS. */
export const PART_INKS = ['blue', 'pink', 'mint', 'gold', 'violet'] as const;
export type PartInk = (typeof PART_INKS)[number];

export function inkVar(i: number): string {
  return `rgb(var(--${PART_INKS[i % PART_INKS.length]}))`;
}

export interface PlayNote {
  /** Verovio element id — also the DOM id of the <g class="note"> in the SVG. */
  id: string;
  /** MIDI pitch, 0-127. */
  midi: number;
  /** Onset in quarter notes from the start of the score. Tempo-independent. */
  q: number;
  /** Duration in quarter notes. */
  qDur: number;
  /** Index into Score.parts. */
  part: number;
  /**
   * Position of this note among its part's sounding notes, in document order.
   * Verovio regenerates element ids whenever the score is re-engraved, so this
   * — not `id` — is what the editor uses to hold a selection across an edit,
   * and to line a note up with its `<note>` element in the MusicXML.
   */
  ordinal: number;
  /** 1-based measure number this note starts in. */
  measure: number;
  /** Lyric syllable attached to this note, if any. */
  syllable?: string;
  /** True when the syllable continues into the next note (word not finished). */
  syllableContinues?: boolean;
}

export interface Part {
  index: number;
  /** Display name, e.g. "Soprano". */
  name: string;
  /** Short label for tight spaces, e.g. "S". */
  abbrev: string;
  /** Verovio staff element ids that belong to this part. */
  staffIds: string[];
  /** 1-based staff numbers occupied by this part. */
  staffNumbers: number[];
  /** True when the part carries lyrics — candidate for ClefVox. */
  hasLyrics: boolean;
  /** Median pitch, used to guess a sensible default instrument and voice type. */
  medianMidi: number;
  lowMidi: number;
  highMidi: number;
}

export interface Score {
  id: string;
  title: string;
  composer: string;
  /** Original MusicXML, kept so we can re-render at other zoom levels and export. */
  musicXml: string;
  parts: Part[];
  notes: PlayNote[];
  /** Total length in quarter notes. */
  totalQ: number;
  /** Quarter notes per measure, indexed by 1-based measure number. */
  measureQ: Map<number, { start: number; length: number }>;
  measureCount: number;
  /** Tempo marked in the score, used as the starting BPM. */
  bpm: number;
  /** Beats per bar and beat unit from the first time signature. */
  beatsPerBar: number;
  beatUnit: number;
  /** Where the score came from, shown in the library. */
  source: 'bundled' | 'musicxml' | 'midi' | 'pdf-embedded' | 'omr' | 'generated';
}

export const MIDI_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function midiName(m: number): string {
  return `${MIDI_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * Quarter notes → seconds.
 *
 * `bpm` is always quarter-notes-per-minute internally (the MIDI convention),
 * whatever the time signature. Compound meters are only a display concern —
 * keeping one unit here means loops, ramps and the metronome can't drift apart.
 */
export function qToSec(q: number, bpm: number): number {
  return (q * 60) / bpm;
}

export function secToQ(s: number, bpm: number): number {
  return (s * bpm) / 60;
}
