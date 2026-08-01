/**
 * Standard MIDI File → MusicXML.
 *
 * MIDI has no notion of a staff, a beam or a spelling, so this quantises to a
 * musical grid and picks reasonable enharmonics. It's an approximation by
 * nature — but it's an exact one for pitch and rhythm, which is what playback
 * and practice need.
 */

import { buildMusicXml, type PartSpec, type ScoreSpec } from './builder';

interface RawEvent {
  tick: number;
  type: 'on' | 'off' | 'tempo' | 'timesig' | 'keysig' | 'name' | 'program';
  channel?: number;
  note?: number;
  velocity?: number;
  usPerQuarter?: number;
  numerator?: number;
  denominator?: number;
  fifths?: number;
  text?: string;
  program?: number;
}

class Reader {
  private pos = 0;
  constructor(private view: DataView) {}
  get offset() {
    return this.pos;
  }
  set offset(v: number) {
    this.pos = v;
  }
  u8() {
    return this.view.getUint8(this.pos++);
  }
  u16() {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  bytes(n: number) {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return out;
  }
  str(n: number) {
    return new TextDecoder().decode(this.bytes(n));
  }
  /** MIDI variable-length quantity. */
  vlq() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return value;
  }
  get done() {
    return this.pos >= this.view.byteLength;
  }
}

function parseTracks(buf: ArrayBuffer): { tracks: RawEvent[][]; ppq: number } {
  const r = new Reader(new DataView(buf));
  if (r.str(4) !== 'MThd') throw new Error('Not a MIDI file.');
  r.u32();
  r.u16(); // format
  const trackCount = r.u16();
  const division = r.u16();
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported.');
  const ppq = division;

  const tracks: RawEvent[][] = [];
  for (let t = 0; t < trackCount && !r.done; t++) {
    if (r.str(4) !== 'MTrk') break;
    const length = r.u32();
    const end = r.offset + length;
    const events: RawEvent[] = [];
    let tick = 0;
    let runningStatus = 0;

    while (r.offset < end) {
      tick += r.vlq();
      let status = r.u8();
      if (status < 0x80) {
        // Running status: reuse the previous status byte.
        r.offset -= 1;
        status = runningStatus;
      } else {
        runningStatus = status;
      }

      const kind = status & 0xf0;
      const channel = status & 0x0f;

      if (status === 0xff) {
        const metaType = r.u8();
        const len = r.vlq();
        const start = r.offset;
        if (metaType === 0x51 && len === 3) {
          const a = r.u8(), b = r.u8(), c = r.u8();
          events.push({ tick, type: 'tempo', usPerQuarter: (a << 16) | (b << 8) | c });
        } else if (metaType === 0x58 && len >= 2) {
          const num = r.u8();
          const den = r.u8();
          events.push({ tick, type: 'timesig', numerator: num, denominator: Math.pow(2, den) });
        } else if (metaType === 0x59 && len >= 1) {
          const sf = r.u8();
          events.push({ tick, type: 'keysig', fifths: sf > 127 ? sf - 256 : sf });
        } else if (metaType === 0x03 || metaType === 0x04) {
          events.push({ tick, type: 'name', text: new TextDecoder().decode(r.bytes(len)) });
        }
        r.offset = start + len;
      } else if (status === 0xf0 || status === 0xf7) {
        const len = r.vlq();
        r.offset += len;
      } else if (kind === 0x90 || kind === 0x80) {
        const note = r.u8();
        const velocity = r.u8();
        events.push({
          tick,
          type: kind === 0x90 && velocity > 0 ? 'on' : 'off',
          channel,
          note,
          velocity,
        });
      } else if (kind === 0xc0) {
        events.push({ tick, type: 'program', channel, program: r.u8() });
      } else if (kind === 0xa0 || kind === 0xb0 || kind === 0xe0) {
        r.offset += 2;
      } else if (kind === 0xd0) {
        r.offset += 1;
      } else {
        break;
      }
    }
    r.offset = end;
    tracks.push(events);
  }
  return { tracks, ppq };
}

interface Sounding {
  note: number;
  startTick: number;
  endTick: number;
}

const GRID = 0.25; // quantise to 16th notes

function quantise(q: number): number {
  return Math.round(q / GRID) * GRID;
}

/** Longest note token that fits, then the remainder becomes a tie. */
function toTokens(pitch: string, qLen: number): string[] {
  const out: string[] = [];
  const units: Array<[number, string]> = [
    [4, 'w'], [3, 'h.'], [2, 'h'], [1.5, 'q.'], [1, 'q'], [0.75, 'e.'], [0.5, 'e'], [0.25, 's'],
  ];
  let left = qLen;
  let guard = 0;
  while (left >= GRID - 1e-9 && guard++ < 64) {
    const pick = units.find(([len]) => len <= left + 1e-9);
    if (!pick) break;
    const [len, code] = pick;
    left -= len;
    const more = left >= GRID - 1e-9;
    out.push(`${pitch}:${code}${more && pitch !== 'r' ? '~' : ''}`);
  }
  return out;
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function spell(midi: number, fifths: number): string {
  const names = fifths < 0 ? FLAT_NAMES : SHARP_NAMES;
  const pc = ((midi % 12) + 12) % 12;
  return `${names[pc]}${Math.floor(midi / 12) - 1}`;
}

const GM_NAMES = [
  'Piano', 'Bright Piano', 'Electric Grand', 'Honky-tonk', 'Electric Piano', 'Electric Piano 2',
  'Harpsichord', 'Clavinet', 'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
  'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer', 'Organ', 'Percussive Organ',
  'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Bandoneon',
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdrive Guitar',
  'Distortion Guitar', 'Guitar Harmonics', 'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass',
  'Slap Bass', 'Slap Bass 2', 'Synth Bass', 'Synth Bass 2', 'Violin', 'Viola',
  'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Harp', 'Timpani',
  'Strings', 'Slow Strings', 'Synth Strings', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs',
  'Synth Voice', 'Orchestra Hit', 'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet',
  'French Horn', 'Brass Section', 'Synth Brass', 'Synth Brass 2', 'Soprano Sax', 'Alto Sax',
  'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute',
];

/** Convert a MIDI file to MusicXML. */
export function midiToMusicXml(buf: ArrayBuffer, fallbackTitle = 'MIDI import'): string {
  const { tracks, ppq } = parseTracks(buf);

  let usPerQuarter = 500000;
  let numerator = 4;
  let denominator = 4;
  let fifths = 0;
  let title = '';

  for (const track of tracks) {
    for (const e of track) {
      if (e.type === 'tempo' && e.usPerQuarter) usPerQuarter = e.usPerQuarter;
      if (e.type === 'timesig') {
        numerator = e.numerator ?? 4;
        denominator = e.denominator ?? 4;
      }
      if (e.type === 'keysig' && e.fifths != null) fifths = e.fifths;
      if (e.type === 'name' && !title && e.text) title = e.text.trim();
    }
  }
  const bpm = Math.round(60000000 / usPerQuarter);

  // Gather sounding notes per track, splitting drums (channel 9) out entirely.
  const parts: PartSpec[] = [];
  tracks.forEach((events, ti) => {
    const open = new Map<number, number>();
    const notes: Sounding[] = [];
    let name = '';
    let program = -1;

    for (const e of events) {
      if (e.type === 'name' && !name && e.text) name = e.text.trim();
      if (e.type === 'program' && program < 0 && e.channel !== 9) program = e.program ?? -1;
      if (e.channel === 9) continue;
      if (e.type === 'on' && e.note != null) {
        open.set(e.note, e.tick);
      } else if (e.type === 'off' && e.note != null) {
        const start = open.get(e.note);
        if (start != null) {
          notes.push({ note: e.note, startTick: start, endTick: e.tick });
          open.delete(e.note);
        }
      }
    }
    if (!notes.length) return;

    // One line per track: where chords occur, keep the top voice. Verovio can
    // engrave chords, but a monophonic line is far more useful for practice.
    notes.sort((a, b) => a.startTick - b.startTick || b.note - a.note);
    const mono: Sounding[] = [];
    for (const n of notes) {
      const prev = mono[mono.length - 1];
      if (prev && Math.abs(prev.startTick - n.startTick) < ppq * GRID * 0.5) continue;
      if (prev && n.startTick < prev.endTick) prev.endTick = n.startTick;
      mono.push({ ...n });
    }

    const tokens: string[] = [];
    let cursorQ = 0;
    for (const n of mono) {
      const startQ = quantise(n.startTick / ppq);
      const endQ = quantise(n.endTick / ppq);
      const len = Math.max(GRID, endQ - startQ);
      if (startQ > cursorQ + 1e-9) tokens.push(...toTokens('r', quantise(startQ - cursorQ)));
      tokens.push(...toTokens(spell(n.note, fifths), len));
      cursorQ = startQ + len;
    }
    if (!tokens.length) return;

    const median = mono.map((n) => n.note).sort((a, b) => a - b)[Math.floor(mono.length / 2)];
    const label = name || (program >= 0 ? GM_NAMES[program] ?? `Track ${ti + 1}` : `Track ${ti + 1}`);
    parts.push({
      name: label,
      clef: median < 55 ? 'F4' : 'G2',
      notes: tokens.join(' '),
    });
  });

  if (!parts.length) throw new Error('That MIDI file has no pitched notes to convert.');

  const spec: ScoreSpec = {
    title: title || fallbackTitle,
    composer: 'Imported from MIDI',
    fifths,
    time: [numerator, denominator],
    bpm,
    // More than eight staves becomes unreadable and very slow to engrave.
    parts: parts.slice(0, 8),
  };
  return buildMusicXml(spec);
}
