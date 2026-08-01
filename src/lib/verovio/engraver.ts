import type { Part, PlayNote, Score } from '../score/types';

/**
 * Verovio wrapper.
 *
 * Verovio is the single source of truth: it engraves the SVG *and* produces the
 * timemap we schedule audio from. Because both come from the same pass, a note
 * cannot light up at a different moment than it sounds.
 *
 * The WASM module is ~10 MB, so it loads lazily on first use and is shared.
 */

type ToolkitLike = {
  setOptions(o: Record<string, unknown>): void;
  loadData(data: string): number;
  getPageCount(): number;
  renderToSVG(page: number): string;
  renderToTimemap(o: Record<string, unknown>): TimemapEntry[];
  getElementAttr(id: string): Record<string, string>;
  getMIDIValuesForElement(id: string): { duration: number; pitch: number; time: number };
  renderToMIDI(): string;
  getTimeForElement(id: string): number;
};

interface TimemapEntry {
  tstamp: number;
  qstamp: number;
  tempo?: number;
  measureOn?: string;
  on?: string[];
  off?: string[];
}

let toolkitPromise: Promise<ToolkitLike> | null = null;

export function loadToolkit(): Promise<ToolkitLike> {
  if (!toolkitPromise) {
    toolkitPromise = (async () => {
      const [{ default: createModule }, { VerovioToolkit }] = await Promise.all([
        import('verovio/wasm'),
        import('verovio/esm'),
      ]);
      const mod = await createModule();
      return new VerovioToolkit(mod) as unknown as ToolkitLike;
    })();
  }
  return toolkitPromise;
}

/** Layout options. `pageWidth` is in Verovio units (1/100 mm at scale 100). */
export interface EngraveOptions {
  pageWidth: number;
  scale: number;
  spacingStaff: number;
  /** 'auto' reflows to the width; 'encoded' keeps the publisher's line breaks. */
  breaks: 'auto' | 'encoded' | 'none';
}

export const DEFAULT_ENGRAVE: EngraveOptions = {
  pageWidth: 2100,
  scale: 42,
  spacingStaff: 10,
  breaks: 'auto',
};

function baseOptions(o: EngraveOptions) {
  return {
    scale: o.scale,
    pageWidth: o.pageWidth,
    pageHeight: 60000,
    adjustPageHeight: true,
    adjustPageWidth: false,
    breaks: o.breaks,
    footer: 'none',
    header: 'none',
    // Give lyrics room; choral scores are the primary audience.
    spacingStaff: o.spacingStaff,
    spacingSystem: 8,
    lyricSize: 4.2,
    svgViewBox: true,
    // Note: svgHtml5 must stay off. It rewrites `id` to `data-id`, which
    // silently breaks every id lookup we depend on — part assignment, lyrics
    // and the highlighting itself.
    // Keep ids stable across renders so highlighting survives a re-layout.
    xmlIdSeed: 1,
    mmOutput: false,
  };
}

/** Render the currently loaded data to a single concatenated SVG string. */
function renderAllPages(tk: ToolkitLike): string {
  const pages = tk.getPageCount();
  if (pages <= 1) return tk.renderToSVG(1);
  return Array.from({ length: pages }, (_, i) => tk.renderToSVG(i + 1)).join('\n');
}

const STEP_TO_SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** Fallback pitch derivation when getMIDIValuesForElement is unavailable. */
function attrsToMidi(a: Record<string, string>): number | null {
  const p = a.pname?.toLowerCase();
  const o = a.oct != null ? parseInt(a.oct, 10) : NaN;
  if (!p || Number.isNaN(o) || !(p in STEP_TO_SEMI)) return null;
  let m = (o + 1) * 12 + STEP_TO_SEMI[p];
  const accid = a['accid.ges'] ?? a.accid;
  if (accid === 's') m += 1;
  else if (accid === 'f') m -= 1;
  else if (accid === 'ss' || accid === 'x') m += 2;
  else if (accid === 'ff') m -= 2;
  return m;
}

/**
 * Read title/composer/part names out of the source MusicXML.
 * Verovio's MEI conversion keeps them, but the original is easier to trust.
 */
function readMetadata(xml: string) {
  let title = '';
  let composer = '';
  const partNames: string[] = [];
  const partAbbrevs: string[] = [];
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return { title, composer, partNames, partAbbrevs };
    title =
      doc.querySelector('work > work-title')?.textContent?.trim() ??
      doc.querySelector('movement-title')?.textContent?.trim() ??
      '';
    const creators = Array.from(doc.querySelectorAll('identification > creator'));
    composer =
      creators.find((c) => c.getAttribute('type') === 'composer')?.textContent?.trim() ??
      creators[0]?.textContent?.trim() ??
      '';
    for (const sp of Array.from(doc.querySelectorAll('part-list > score-part'))) {
      partNames.push(sp.querySelector('part-name')?.textContent?.trim() ?? '');
      partAbbrevs.push(sp.querySelector('part-abbreviation')?.textContent?.trim() ?? '');
    }
  } catch {
    /* metadata is a nicety; never fail an import over it */
  }
  return { title, composer, partNames, partAbbrevs };
}

function readTimeSignature(xml: string): { beatsPerBar: number; beatUnit: number; bpm: number } {
  let beatsPerBar = 4;
  let beatUnit = 4;
  let bpm = 0;
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const beats = doc.querySelector('time > beats')?.textContent;
    const bt = doc.querySelector('time > beat-type')?.textContent;
    if (beats) beatsPerBar = parseInt(beats, 10) || 4;
    if (bt) beatUnit = parseInt(bt, 10) || 4;
    const perMinute = doc.querySelector('metronome > per-minute')?.textContent;
    const unit = doc.querySelector('metronome > beat-unit')?.textContent ?? 'quarter';
    if (perMinute) {
      const v = parseFloat(perMinute);
      // Normalise the marked tempo to quarter-notes-per-minute.
      const factor =
        unit === 'half' ? 2 : unit === 'eighth' ? 0.5 : unit === 'whole' ? 4 : unit === '16th' ? 0.25 : 1;
      if (v > 0) bpm = v * factor;
    }
    if (!bpm) {
      const sound = doc.querySelector('sound[tempo]')?.getAttribute('tempo');
      if (sound) bpm = parseFloat(sound) || 0;
    }
  } catch {
    /* defaults are fine */
  }
  return { beatsPerBar, beatUnit, bpm: bpm || 90 };
}

const SATB_HINTS: Array<[RegExp, string]> = [
  [/sopran|descant|treble\s*1|^s$/i, 'S'],
  [/alto|contralto|^a$/i, 'A'],
  [/tenor|^t$/i, 'T'],
  [/bass|baritone|^b$/i, 'B'],
];

function abbreviate(name: string, fallbackIndex: number): string {
  for (const [re, ab] of SATB_HINTS) if (re.test(name)) return ab;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return `P${fallbackIndex + 1}`;
  if (words.length === 1) return words[0].slice(0, 4);
  return words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
}

export interface EngraveResult {
  svg: string;
  score: Omit<Score, 'id' | 'source'>;
}

/**
 * Engrave MusicXML (or MEI, or ABC — Verovio sniffs the format) and build the
 * playback model from the same pass.
 */
export async function engrave(musicXml: string, opts: EngraveOptions = DEFAULT_ENGRAVE): Promise<EngraveResult> {
  const tk = await loadToolkit();
  tk.setOptions(baseOptions(opts));
  const ok = tk.loadData(musicXml);
  if (!ok) throw new Error("Verovio couldn't read that file. It may not be valid MusicXML.");

  const svg = renderAllPages(tk);
  const timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: false });

  // Parse the SVG once so we can look up which staff each note sits in and
  // read its lyric syllable straight out of the drawn output.
  const doc = new DOMParser().parseFromString(
    `<div xmlns="http://www.w3.org/1999/xhtml">${svg}</div>`,
    'text/html',
  );

  const staffOfNote = new Map<string, string>();
  const staffOrder: string[] = [];
  const sylOfNote = new Map<string, { text: string; continues: boolean }>();

  const staves = Array.from(doc.querySelectorAll('g.staff'));
  for (const staff of staves) {
    const sid = staff.getAttribute('id') ?? '';
    if (sid && !staffOrder.includes(sid)) staffOrder.push(sid);
    for (const note of Array.from(staff.querySelectorAll('g.note'))) {
      const nid = note.getAttribute('id');
      if (!nid) continue;
      staffOfNote.set(nid, sid);
      const syl = note.querySelector('g.syl');
      if (syl) {
        const text = (syl.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text) {
          // Verovio draws a continuation hyphen as a sibling element; a syllable
          // whose word carries on is marked with a trailing hyphen in the text.
          const continues = /[-‐‑]$/.test(text) || syl.querySelector('.dir, .hyphen') != null;
          sylOfNote.set(nid, { text: text.replace(/[-‐‑]\s*$/, ''), continues });
        }
      }
    }
  }

  // Staff numbering: Verovio emits staves top-to-bottom within each measure, and
  // repeats them per system. The first measure establishes the order.
  const firstMeasure = doc.querySelector('g.measure');
  const staffIdsInOrder = firstMeasure
    ? Array.from(firstMeasure.querySelectorAll('g.staff')).map((s) => s.getAttribute('id') ?? '')
    : staffOrder;

  // Every system re-emits staves with fresh ids, so group by position instead:
  // walk each measure and map its Nth staff to staff number N.
  const staffNumberOf = new Map<string, number>();
  for (const measure of Array.from(doc.querySelectorAll('g.measure'))) {
    const inMeasure = Array.from(measure.querySelectorAll('g.staff'));
    inMeasure.forEach((s, i) => {
      const id = s.getAttribute('id');
      if (id) staffNumberOf.set(id, i + 1);
    });
  }

  const staffCount = Math.max(1, staffIdsInOrder.length);

  // Measure boundaries, from the timemap's measureOn markers.
  const measureQ = new Map<number, { start: number; length: number }>();
  const measureStarts: Array<{ q: number; id: string }> = [];
  for (const e of timemap) {
    if (e.measureOn) measureStarts.push({ q: e.qstamp, id: e.measureOn });
  }
  measureStarts.sort((a, b) => a.q - b.q);

  // Where each note stops, in quarter notes. Taking the duration from the
  // timemap's own off events rather than from millisecond values keeps it
  // completely independent of the score's marked tempo — which matters,
  // because our tempo control has to be the authority.
  const offAtQ = new Map<string, number>();
  for (const entry of timemap) {
    if (!entry.off) continue;
    for (const id of entry.off) {
      if (!offAtQ.has(id)) offAtQ.set(id, entry.qstamp);
    }
  }

  // Notes, in timemap order.
  const notes: PlayNote[] = [];
  const seen = new Set<string>();
  // Counts notes per part as they are encountered, which is document order —
  // the same order the <note> elements appear in the MusicXML.
  const ordinalCounter = new Map<number, number>();
  let totalQ = 0;

  for (const entry of timemap) {
    totalQ = Math.max(totalQ, entry.qstamp);
    if (!entry.on) continue;
    for (const id of entry.on) {
      if (seen.has(id)) continue;
      seen.add(id);

      let midi: number | null = null;
      try {
        const mv = tk.getMIDIValuesForElement(id);
        if (mv && typeof mv.pitch === 'number' && mv.pitch > 0) midi = mv.pitch;
      } catch {
        /* fall through to attribute reading */
      }
      if (midi == null) {
        const attrs = tk.getElementAttr(id);
        midi = attrsToMidi(attrs);
      }
      if (midi == null) continue;

      const off = offAtQ.get(id);
      const qDur = off != null ? Math.max(0.0625, off - entry.qstamp) : 1;

      const sid = staffOfNote.get(id) ?? '';
      const staffNo = staffNumberOf.get(sid) ?? 1;

      let measure = 1;
      for (let i = measureStarts.length - 1; i >= 0; i--) {
        if (entry.qstamp >= measureStarts[i].q - 1e-6) {
          measure = i + 1;
          break;
        }
      }

      const syl = sylOfNote.get(id);
      const part = staffNo - 1;
      const ordinal = ordinalCounter.get(part) ?? 0;
      ordinalCounter.set(part, ordinal + 1);
      notes.push({
        id,
        midi,
        q: entry.qstamp,
        qDur,
        part,
        ordinal,
        measure,
        syllable: syl?.text,
        syllableContinues: syl?.continues,
      });
    }
  }

  // Close out measure lengths now that totalQ is known.
  for (let i = 0; i < measureStarts.length; i++) {
    const start = measureStarts[i].q;
    const end = i + 1 < measureStarts.length ? measureStarts[i + 1].q : totalQ;
    measureQ.set(i + 1, { start, length: Math.max(0, end - start) });
  }
  if (!measureQ.size) measureQ.set(1, { start: 0, length: totalQ });

  // Extend totalQ past the last note so the final chord isn't cut off.
  for (const n of notes) totalQ = Math.max(totalQ, n.q + n.qDur);

  const meta = readMetadata(musicXml);
  const time = readTimeSignature(musicXml);

  const parts: Part[] = [];
  for (let i = 0; i < staffCount; i++) {
    const mine = notes.filter((n) => n.part === i);
    const pitches = mine.map((n) => n.midi).sort((a, b) => a - b);
    const name = meta.partNames[i]?.trim() || `Part ${i + 1}`;
    parts.push({
      index: i,
      name,
      abbrev: meta.partAbbrevs[i]?.trim() || abbreviate(name, i),
      staffIds: staffIdsInOrder.filter((_, k) => k === i),
      staffNumbers: [i + 1],
      hasLyrics: mine.some((n) => n.syllable),
      medianMidi: pitches.length ? pitches[Math.floor(pitches.length / 2)] : 60,
      lowMidi: pitches[0] ?? 60,
      highMidi: pitches[pitches.length - 1] ?? 72,
    });
  }

  return {
    svg,
    score: {
      title: meta.title || 'Untitled score',
      composer: meta.composer,
      musicXml,
      parts,
      notes: notes.sort((a, b) => a.q - b.q || a.part - b.part),
      totalQ,
      measureQ,
      measureCount: measureQ.size,
      bpm: Math.round(time.bpm),
      beatsPerBar: time.beatsPerBar,
      beatUnit: time.beatUnit,
    },
  };
}

/** Export the loaded score as a base64 MIDI string (used by the export menu). */
export async function toMidiBase64(musicXml: string): Promise<string> {
  const tk = await loadToolkit();
  tk.setOptions(baseOptions(DEFAULT_ENGRAVE));
  tk.loadData(musicXml);
  return tk.renderToMIDI();
}
