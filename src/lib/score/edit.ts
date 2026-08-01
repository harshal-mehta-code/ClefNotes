import type { Score } from './types';

/**
 * Editing notes in the MusicXML.
 *
 * Recognition is never perfect, so the ability to fix a wrong note is what
 * separates a score you can rely on from a curiosity. Edits are applied to the
 * MusicXML itself rather than to a derived model, so what you correct is what
 * gets played, exported and saved.
 *
 * Notes are located by ordinal — the nth sounding note of a part — because
 * Verovio regenerates element ids on every re-engraving.
 */

const STEP_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export interface EditTarget {
  part: number;
  ordinal: number;
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The score XML could not be parsed.');
  return doc;
}

function serialise(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

/** All pitched (non-rest, non-grace) note elements of a part, in document order. */
function pitchedNotes(doc: Document, partIndex: number): Element[] {
  const parts = Array.from(doc.querySelectorAll('score-partwise > part'));
  const part = parts[partIndex];
  if (!part) return [];
  return Array.from(part.querySelectorAll('note')).filter(
    (n) => n.querySelector('pitch') && !n.querySelector('grace'),
  );
}

/**
 * Whether the editor can safely act on this score.
 *
 * The mapping from model note to XML element is positional, so it is only
 * trustworthy when the counts agree exactly. Rather than risk editing the
 * wrong note in an unusual score, editing is simply disabled there.
 */
export function canEdit(score: Score): { ok: boolean; reason?: string } {
  try {
    const doc = parseXml(score.musicXml);
    for (let p = 0; p < score.parts.length; p++) {
      const modelCount = score.notes.filter((n) => n.part === p).length;
      const xmlCount = pitchedNotes(doc, p).length;
      if (modelCount !== xmlCount) {
        return {
          ok: false,
          reason:
            'This score has voicing the editor cannot line up note-for-note (chords or multiple voices on one staff), so editing is turned off rather than risk changing the wrong note.',
        };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'This score could not be re-read for editing.' };
  }
}

function readPitch(note: Element): { midi: number; step: string; alter: number; octave: number } | null {
  const pitch = note.querySelector('pitch');
  if (!pitch) return null;
  const step = pitch.querySelector('step')?.textContent?.trim().toUpperCase() ?? 'C';
  const alter = parseInt(pitch.querySelector('alter')?.textContent ?? '0', 10) || 0;
  const octave = parseInt(pitch.querySelector('octave')?.textContent ?? '4', 10) || 4;
  return { midi: (octave + 1) * 12 + STEP_SEMI[step] + alter, step, alter, octave };
}

/** Prefer a natural spelling, then a sharp; keeps accidentals readable. */
const SPELLINGS: Array<[string, number]> = [
  ['C', 0], ['C', 1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];

function writePitch(doc: Document, note: Element, midi: number, preferFlat = false) {
  const clamped = Math.max(12, Math.min(115, midi));
  const pc = ((clamped % 12) + 12) % 12;
  const octave = Math.floor(clamped / 12) - 1;
  let [step, alter] = SPELLINGS[pc];
  if (preferFlat && alter === 1) {
    // Respell C♯ as D♭ etc. when the user asked for a flat.
    const next = LETTERS[(LETTERS.indexOf(step) + 1) % 7];
    step = next;
    alter = -1;
  }

  const pitch = note.querySelector('pitch');
  if (!pitch) return;
  pitch.textContent = '';
  const stepEl = doc.createElement('step');
  stepEl.textContent = step;
  pitch.appendChild(stepEl);
  if (alter !== 0) {
    const alterEl = doc.createElement('alter');
    alterEl.textContent = String(alter);
    pitch.appendChild(alterEl);
  }
  const octEl = doc.createElement('octave');
  octEl.textContent = String(octave);
  pitch.appendChild(octEl);

  // Keep the printed accidental in step with the sounding pitch.
  const existing = note.querySelector('accidental');
  existing?.remove();
  if (alter !== 0) {
    const acc = doc.createElement('accidental');
    acc.textContent = alter === 1 ? 'sharp' : 'flat';
    const anchor = note.querySelector('type');
    if (anchor && anchor.parentNode) {
      // Accidental follows type and any dots.
      let after: Element = anchor;
      let sibling = anchor.nextElementSibling;
      while (sibling && sibling.tagName === 'dot') {
        after = sibling;
        sibling = sibling.nextElementSibling;
      }
      after.after(acc);
    } else {
      note.appendChild(acc);
    }
  }
}

export interface EditResult {
  musicXml: string;
  /** What changed, for the status line. */
  description: string;
}

/** Move a note by a number of semitones. */
export function shiftNote(score: Score, target: EditTarget, semitones: number, preferFlat = false): EditResult {
  const doc = parseXml(score.musicXml);
  const notes = pitchedNotes(doc, target.part);
  const note = notes[target.ordinal];
  if (!note) throw new Error('That note is no longer in the score.');
  const current = readPitch(note);
  if (!current) throw new Error('That element has no pitch to change.');
  const next = current.midi + semitones;
  writePitch(doc, note, next, preferFlat);
  return {
    musicXml: serialise(doc),
    description: `${nameOf(current.midi)} → ${nameOf(next)}`,
  };
}

/** Set a note to an absolute MIDI pitch. */
export function setNotePitch(score: Score, target: EditTarget, midi: number): EditResult {
  const doc = parseXml(score.musicXml);
  const note = pitchedNotes(doc, target.part)[target.ordinal];
  if (!note) throw new Error('That note is no longer in the score.');
  const current = readPitch(note);
  writePitch(doc, note, midi);
  return {
    musicXml: serialise(doc),
    description: `${current ? nameOf(current.midi) : '?'} → ${nameOf(midi)}`,
  };
}

/**
 * Turn a note into a rest of the same length.
 *
 * Deleting outright would leave the bar short and the rest of the part would
 * shift; replacing with a rest keeps every following note exactly where it was,
 * which is what you want when clearing something recognition invented.
 */
export function noteToRest(score: Score, target: EditTarget): EditResult {
  const doc = parseXml(score.musicXml);
  const note = pitchedNotes(doc, target.part)[target.ordinal];
  if (!note) throw new Error('That note is no longer in the score.');
  const current = readPitch(note);

  const pitch = note.querySelector('pitch');
  if (pitch) {
    const rest = doc.createElement('rest');
    pitch.replaceWith(rest);
  }
  // Anything that only makes sense on a pitch has to go with it.
  for (const sel of ['lyric', 'notations', 'tie', 'stem', 'beam', 'accidental', 'chord']) {
    note.querySelectorAll(sel).forEach((el) => el.remove());
  }
  return {
    musicXml: serialise(doc),
    description: `${current ? nameOf(current.midi) : 'note'} removed`,
  };
}

/** Replace the syllable sung on a note. */
export function setLyric(score: Score, target: EditTarget, text: string): EditResult {
  const doc = parseXml(score.musicXml);
  const note = pitchedNotes(doc, target.part)[target.ordinal];
  if (!note) throw new Error('That note is no longer in the score.');
  note.querySelectorAll('lyric').forEach((el) => el.remove());
  const trimmed = text.trim();
  if (trimmed) {
    const lyric = doc.createElement('lyric');
    lyric.setAttribute('number', '1');
    const syllabic = doc.createElement('syllabic');
    syllabic.textContent = trimmed.endsWith('-') ? 'begin' : 'single';
    const textEl = doc.createElement('text');
    textEl.textContent = trimmed.replace(/-$/, '');
    lyric.appendChild(syllabic);
    lyric.appendChild(textEl);
    note.appendChild(lyric);
  }
  return { musicXml: serialise(doc), description: trimmed ? `lyric "${trimmed}"` : 'lyric cleared' };
}

/** Transpose a whole part, written pitch and all. */
export function transposePart(score: Score, partIndex: number, semitones: number): EditResult {
  const doc = parseXml(score.musicXml);
  for (const note of pitchedNotes(doc, partIndex)) {
    const current = readPitch(note);
    if (current) writePitch(doc, note, current.midi + semitones);
  }
  return {
    musicXml: serialise(doc),
    description: `${score.parts[partIndex]?.name ?? 'part'} ${semitones > 0 ? '+' : ''}${semitones} semitones`,
  };
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
function nameOf(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
