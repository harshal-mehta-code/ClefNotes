/**
 * A compact score DSL that compiles to MusicXML.
 *
 * Hand-writing MusicXML is unreadable and error-prone, and three different
 * features need to emit it: the bundled shelf, the sight-reading generator, and
 * the OMR pipeline. They all go through here.
 *
 * Note tokens look like:  G4:q   Bb3:h.   F#5:e~   r:q
 *   pitch  — letter, optional # / b, octave (middle C is C4); `r` for a rest
 *   :dur   — w h q e s (whole/half/quarter/eighth/16th), `.` dotted, `~` tied
 * Bars are inferred from the time signature; `|` is allowed as a readability
 * hint and is validated against the computed bar length.
 */

export interface PartSpec {
  name: string;
  abbrev?: string;
  /** 'G2' treble, 'F4' bass, 'C3' alto. */
  clef: 'G2' | 'F4' | 'C3' | 'G2-8';
  notes: string;
  /** One syllable per sounding note, in order. Trailing '-' keeps the word open. */
  lyrics?: string[];
  /** Shift every note by this many semitones (used for octave-doubled parts). */
  transpose?: number;
  /** Rests inserted before the part enters, in quarter notes — for rounds. */
  offsetQ?: number;
}

export interface ScoreSpec {
  title: string;
  composer?: string;
  /** Circle-of-fifths count: -1 = F major, +1 = G major, etc. */
  fifths?: number;
  time?: [number, number];
  /** Quarter notes per minute. */
  bpm?: number;
  parts: PartSpec[];
}

const DIVISIONS = 24; // per quarter note — divides by 2 and 3, so triplets work

const DUR_Q: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 1 / 3 };
const TYPE_NAME: Record<string, string> = {
  w: 'whole',
  h: 'half',
  q: 'quarter',
  e: 'eighth',
  s: '16th',
  t: 'eighth',
};

const STEP_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface ParsedNote {
  rest: boolean;
  step?: string;
  alter?: number;
  octave?: number;
  qDur: number;
  typeName: string;
  dots: number;
  tie: boolean;
  triplet: boolean;
}

function parseToken(tok: string): ParsedNote | null {
  if (tok === '|' || tok === '') return null;
  const m = /^([A-Ga-g](?:#|b)?-?\d|r)(?::([whqest])(\.*)(~?))?$/.exec(tok.trim());
  if (!m) throw new Error(`Unreadable note token: "${tok}"`);
  const [, pitchPart, durChar = 'q', dotStr = '', tieStr = ''] = m;
  const base = DUR_Q[durChar];
  const dots = dotStr.length;
  let qDur = base;
  for (let i = 1; i <= dots; i++) qDur += base / Math.pow(2, i);

  if (pitchPart === 'r') {
    return { rest: true, qDur, typeName: TYPE_NAME[durChar], dots, tie: false, triplet: durChar === 't' };
  }
  const pm = /^([A-Ga-g])(#|b)?(-?\d)$/.exec(pitchPart)!;
  const step = pm[1].toUpperCase();
  const alter = pm[2] === '#' ? 1 : pm[2] === 'b' ? -1 : 0;
  const octave = parseInt(pm[3], 10);
  return {
    rest: false,
    step,
    alter,
    octave,
    qDur,
    typeName: TYPE_NAME[durChar],
    dots,
    tie: tieStr === '~',
    triplet: durChar === 't',
  };
}

function transposeNote(n: ParsedNote, semis: number): ParsedNote {
  if (n.rest || semis === 0 || n.step == null || n.octave == null) return n;
  const abs = (n.octave + 1) * 12 + STEP_SEMI[n.step] + (n.alter ?? 0) + semis;
  const pc = ((abs % 12) + 12) % 12;
  const oct = Math.floor(abs / 12) - 1;
  // Prefer natural spellings, falling back to sharps.
  const spellings: Array<[string, number]> = [
    ['C', 0], ['C', 1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
    ['F', 1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
  ];
  const [step, alter] = spellings[pc];
  return { ...n, step, alter, octave: oct };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Compile a ScoreSpec into MusicXML 3.1 (partwise). */
export function buildMusicXml(spec: ScoreSpec): string {
  const [beats, beatType] = spec.time ?? [4, 4];
  const fifths = spec.fifths ?? 0;
  const qPerBar = (beats * 4) / beatType;

  const partsXml: string[] = [];
  const partListXml: string[] = [];

  spec.parts.forEach((part, pi) => {
    const id = `P${pi + 1}`;
    partListXml.push(
      `    <score-part id="${id}">\n` +
        `      <part-name>${esc(part.name)}</part-name>\n` +
        (part.abbrev ? `      <part-abbreviation>${esc(part.abbrev)}</part-abbreviation>\n` : '') +
        `    </score-part>`,
    );

    const tokens = part.notes.split(/\s+/).filter(Boolean);
    let parsed: ParsedNote[] = [];
    for (const t of tokens) {
      const p = parseToken(t);
      if (p) parsed.push(part.transpose ? transposeNote(p, part.transpose) : p);
    }

    // Rounds: pad the front with rests so the part enters late.
    if (part.offsetQ && part.offsetQ > 0) {
      const pad: ParsedNote[] = [];
      let left = part.offsetQ;
      while (left > 0) {
        const chunk = Math.min(left, 4);
        const durChar = chunk >= 4 ? 'w' : chunk >= 2 ? 'h' : chunk >= 1 ? 'q' : 'e';
        pad.push({
          rest: true,
          qDur: DUR_Q[durChar],
          typeName: TYPE_NAME[durChar],
          dots: 0,
          tie: false,
          triplet: false,
        });
        left -= DUR_Q[durChar];
      }
      parsed = [...pad, ...parsed];
    }

    // Lay notes into measures, splitting any note that straddles a barline
    // into a tied pair so the engraving stays legal.
    const measures: ParsedNote[][] = [];
    let cur: ParsedNote[] = [];
    let filled = 0;
    for (const note of parsed) {
      let remaining = note.qDur;
      let first = true;
      while (remaining > 1e-9) {
        const room = qPerBar - filled;
        const take = Math.min(room, remaining);
        const piece: ParsedNote = {
          ...note,
          qDur: take,
          typeName: nearestType(take),
          dots: dotsFor(take),
          tie: note.tie || take < remaining - 1e-9 || (!first && remaining > take + 1e-9),
        };
        // A split note is tied to its continuation.
        if (take < remaining - 1e-9) piece.tie = true;
        cur.push(piece);
        filled += take;
        remaining -= take;
        first = false;
        if (filled >= qPerBar - 1e-9) {
          measures.push(cur);
          cur = [];
          filled = 0;
        }
      }
    }
    if (cur.length) {
      // Pad the last bar with a rest so it is complete.
      const short = qPerBar - filled;
      if (short > 1e-9) {
        cur.push({
          rest: true,
          qDur: short,
          typeName: nearestType(short),
          dots: dotsFor(short),
          tie: false,
          triplet: false,
        });
      }
      measures.push(cur);
    }

    const lyrics = part.lyrics ?? [];
    let lyricIdx = 0;
    const measureXml = measures.map((notes, mi) => {
      const body: string[] = [];
      if (mi === 0) {
        body.push(
          `      <attributes>\n` +
            `        <divisions>${DIVISIONS}</divisions>\n` +
            `        <key><fifths>${fifths}</fifths></key>\n` +
            `        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>\n` +
            `        <clef>${clefXml(part.clef)}</clef>\n` +
            `      </attributes>`,
        );
        // Tempo belongs to the score, not to each part — emitting it in every
        // part prints a metronome mark above every staff.
        if (spec.bpm && pi === 0) {
          body.push(
            `      <direction placement="above">\n` +
              `        <direction-type><metronome><beat-unit>quarter</beat-unit>` +
              `<per-minute>${Math.round(spec.bpm)}</per-minute></metronome></direction-type>\n` +
              `        <sound tempo="${Math.round(spec.bpm)}"/>\n` +
              `      </direction>`,
          );
        }
      }

      for (const n of notes) {
        const dur = Math.max(1, Math.round(n.qDur * DIVISIONS));
        if (n.rest) {
          body.push(
            `      <note>\n        <rest/>\n        <duration>${dur}</duration>\n` +
              `        <type>${n.typeName}</type>\n${'          <dot/>\n'.repeat(n.dots)}      </note>`,
          );
          continue;
        }
        const syl = lyrics[lyricIdx];
        lyricIdx++;
        const lyricXml = syl
          ? `        <lyric number="1"><syllabic>${
              syl.endsWith('-') ? 'begin' : 'single'
            }</syllabic><text>${esc(syl.replace(/-$/, ''))}</text></lyric>\n`
          : '';
        body.push(
          `      <note>\n` +
            `        <pitch><step>${n.step}</step>` +
            (n.alter ? `<alter>${n.alter}</alter>` : '') +
            `<octave>${n.octave}</octave></pitch>\n` +
            `        <duration>${dur}</duration>\n` +
            (n.tie ? `        <tie type="start"/>\n` : '') +
            `        <type>${n.typeName}</type>\n` +
            '        <dot/>\n'.repeat(n.dots) +
            (n.tie ? `        <notations><tied type="start"/></notations>\n` : '') +
            lyricXml +
            `      </note>`,
        );
      }
      return `    <measure number="${mi + 1}">\n${body.join('\n')}\n    </measure>`;
    });

    partsXml.push(`  <part id="${id}">\n${measureXml.join('\n')}\n  </part>`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n` +
    `<score-partwise version="3.1">\n` +
    `  <work><work-title>${esc(spec.title)}</work-title></work>\n` +
    (spec.composer
      ? `  <identification><creator type="composer">${esc(spec.composer)}</creator></identification>\n`
      : '') +
    `  <part-list>\n${partListXml.join('\n')}\n  </part-list>\n` +
    `${partsXml.join('\n')}\n` +
    `</score-partwise>\n`
  );
}

function clefXml(clef: PartSpec['clef']): string {
  switch (clef) {
    case 'F4':
      return '<sign>F</sign><line>4</line>';
    case 'C3':
      return '<sign>C</sign><line>3</line>';
    case 'G2-8':
      return '<sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change>';
    default:
      return '<sign>G</sign><line>2</line>';
  }
}

/** Closest undotted note type for an arbitrary quarter-note length. */
function nearestType(q: number): string {
  const table: Array<[number, string]> = [
    [4, 'whole'],
    [2, 'half'],
    [1, 'quarter'],
    [0.5, 'eighth'],
    [0.25, '16th'],
  ];
  for (const [len, name] of table) {
    if (q >= len - 1e-9) return name;
  }
  return '16th';
}

function dotsFor(q: number): number {
  const base = [4, 2, 1, 0.5, 0.25];
  for (const b of base) {
    if (Math.abs(q - b * 1.75) < 1e-6) return 2;
    if (Math.abs(q - b * 1.5) < 1e-6) return 1;
    if (Math.abs(q - b) < 1e-6) return 0;
  }
  return 0;
}
