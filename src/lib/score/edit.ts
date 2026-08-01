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
  const result = transposePartXml(score.musicXml, partIndex, semitones);
  return {
    musicXml: result.musicXml,
    description: `${score.parts[partIndex]?.name ?? 'part'} ${semitones > 0 ? '+' : ''}${semitones} semitones`,
  };
}

/** The same, on raw MusicXML. */
export function transposePartXml(musicXml: string, partIndex: number, semitones: number): EditResult {
  const doc = parseXml(musicXml);
  for (const note of pitchedNotes(doc, partIndex)) {
    const current = readPitch(note);
    if (current) writePitch(doc, note, current.midi + semitones);
  }
  return { musicXml: serialise(doc), description: `${semitones > 0 ? '+' : ''}${semitones} semitones` };
}

export type ClefId = 'G2' | 'G2-8' | 'F4' | 'C3';

export const CLEF_CHOICES: Array<{ id: ClefId; label: string; octave: number }> = [
  { id: 'G2', label: 'Treble', octave: 0 },
  { id: 'G2-8', label: 'Treble 8vb (tenor)', octave: -12 },
  { id: 'F4', label: 'Bass', octave: 0 },
  { id: 'C3', label: 'Alto', octave: 0 },
];

/**
 * Set a part's clef.
 *
 * The tenor clef — a treble sign with a small 8 beneath it — sounds an octave
 * lower than it looks, and recognition cannot see that 8. Reading it as an
 * ordinary treble clef puts a whole voice an octave too high, which is
 * immediately obvious to the ear and impossible to explain. Choosing the clef
 * here fixes both the printed staff and the pitch it sounds at.
 */
export function setPartClef(musicXml: string, partIndex: number, clef: ClefId): EditResult {
  const doc = parseXml(musicXml);
  const part = Array.from(doc.querySelectorAll('score-partwise > part'))[partIndex];
  if (!part) throw new Error('That part is no longer in the score.');

  const existing = part.querySelector('attributes > clef');
  const wasOctaveDown = existing?.querySelector('clef-octave-change')?.textContent === '-1';

  for (const el of Array.from(part.querySelectorAll('attributes > clef'))) {
    el.textContent = '';
    const sign = doc.createElement('sign');
    const line = doc.createElement('line');
    if (clef === 'F4') {
      sign.textContent = 'F';
      line.textContent = '4';
    } else if (clef === 'C3') {
      sign.textContent = 'C';
      line.textContent = '3';
    } else {
      sign.textContent = 'G';
      line.textContent = '2';
    }
    el.appendChild(sign);
    el.appendChild(line);
    if (clef === 'G2-8') {
      const oct = doc.createElement('clef-octave-change');
      oct.textContent = '-1';
      el.appendChild(oct);
    }
  }

  let xml = serialise(doc);
  // MusicXML pitches are what sounds, so switching to or from an octave clef
  // has to move the pitches too, or the staff would read right and sound wrong.
  const nowOctaveDown = clef === 'G2-8';
  if (nowOctaveDown && !wasOctaveDown) xml = transposePartXml(xml, partIndex, -12).musicXml;
  else if (!nowOctaveDown && wasOctaveDown) xml = transposePartXml(xml, partIndex, 12).musicXml;

  const label = CLEF_CHOICES.find((c) => c.id === clef)?.label ?? clef;
  return { musicXml: xml, description: `clef set to ${label}` };
}


export const KEY_CHOICES: Array<{ fifths: number; label: string }> = [
  { fifths: -7, label: 'C♭ major / A♭ minor' },
  { fifths: -6, label: 'G♭ major / E♭ minor' },
  { fifths: -5, label: 'D♭ major / B♭ minor' },
  { fifths: -4, label: 'A♭ major / F minor' },
  { fifths: -3, label: 'E♭ major / C minor' },
  { fifths: -2, label: 'B♭ major / G minor' },
  { fifths: -1, label: 'F major / D minor' },
  { fifths: 0, label: 'C major / A minor' },
  { fifths: 1, label: 'G major / E minor' },
  { fifths: 2, label: 'D major / B minor' },
  { fifths: 3, label: 'A major / F♯ minor' },
  { fifths: 4, label: 'E major / C♯ minor' },
  { fifths: 5, label: 'B major / G♯ minor' },
  { fifths: 6, label: 'F♯ major / D♯ minor' },
  { fifths: 7, label: 'C♯ major / A♯ minor' },
];

/**
 * Set the key signature on every part.
 *
 * Recognition cannot read a key signature reliably, and guessing one is worse
 * than leaving it alone: a wrong key silently mis-pitches every note of that
 * letter for the whole piece. So the user says what the key is, and this
 * applies it. Verovio resolves accidentals from the signature, so setting it
 * corrects the printed notes *and* what they sound like, in one step.
 */
export function setKeySignature(musicXml: string, fifths: number): EditResult {
  const doc = parseXml(musicXml);
  let changed = 0;
  for (const key of Array.from(doc.querySelectorAll('attributes > key'))) {
    let el = key.querySelector('fifths');
    if (!el) {
      el = doc.createElement('fifths');
      key.insertBefore(el, key.firstChild);
    }
    el.textContent = String(fifths);
    changed++;
  }
  if (!changed) {
    // No key element at all: add one to each part's first attributes block.
    for (const attrs of Array.from(doc.querySelectorAll('part > measure > attributes'))) {
      const key = doc.createElement('key');
      const el = doc.createElement('fifths');
      el.textContent = String(fifths);
      key.appendChild(el);
      attrs.insertBefore(key, attrs.querySelector('time') ?? attrs.querySelector('clef'));
    }
  }
  const label = KEY_CHOICES.find((k) => k.fifths === fifths)?.label ?? `${fifths}`;
  return { musicXml: serialise(doc), description: `key set to ${label}` };
}

/** Set the time signature on every part. */
export function setTimeSignature(musicXml: string, beats: number, beatType: number): EditResult {
  const doc = parseXml(musicXml);
  for (const time of Array.from(doc.querySelectorAll('attributes > time'))) {
    const b = time.querySelector('beats');
    const t = time.querySelector('beat-type');
    if (b) b.textContent = String(beats);
    if (t) t.textContent = String(beatType);
  }
  return { musicXml: serialise(doc), description: `${beats}/${beatType}` };
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
function nameOf(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
