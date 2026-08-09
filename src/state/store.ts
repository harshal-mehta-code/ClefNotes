import { create } from 'zustand';
import Dexie, { type Table } from 'dexie';
import { player } from '../lib/audio/player';
import { INSTRUMENTS, type InstrumentId } from '../lib/audio/instruments';
import { importScore } from '../lib/detect/import';
import {
  DEFAULT_PARTS,
  noteMidi,
  scoreParts,
  stepAt,
  type Alter,
  type ClefId,
  type DetectedNote,
  type PageScore,
} from '../lib/detect/types';

/** Scores live on this device. Nothing is uploaded, so there is nothing to sign into. */
class ScoreDb extends Dexie {
  scores!: Table<PageScore, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  constructor() {
    super('clefnotes');
    this.version(2).stores({ scores: 'id, title, openedAt', settings: 'key' });
  }
}
export const db = new ScoreDb();

export type ViewId = 'library' | 'sheet';

interface AppState {
  view: ViewId;
  theme: 'light' | 'dark' | 'system';

  score: PageScore | null;
  library: PageScore[];
  loading: boolean;
  progress: { label: string; fraction: number } | null;
  error: string | null;

  instrument: InstrumentId;
  volume: number;
  /** How wide the page is drawn, as a fraction of the container. */
  zoom: number;
  showNotes: boolean;

  /** The note last clicked — arrow keys correct its pitch. */
  selected: string | null;
  /** Pitches sounding right now, for the keyboard. */
  ringing: number[];
  /** Page currently in view — the piano roll follows it. */
  visiblePage: number;

  /**
   * The part being worked on. With one chosen, the page belongs to it: its
   * notes stay lit while the rest of the score falls back, and a tap or a glide
   * plays that line and nothing else. Null is the whole score, as before.
   * Session state, not saved — which part you are on is where you are looking,
   * not something about the score.
   */
  currentPart: string | null;
  /** Whether a tap puts the note it lands on into the current part. */
  tagging: boolean;

  setView: (v: ViewId) => void;
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  setInstrument: (i: InstrumentId) => void;
  setVolume: (v: number) => void;
  setZoom: (z: number) => void;
  /**
   * Zoom a step at a time. A step relative to the *current* zoom, not to
   * whatever it was when the button last drew itself — otherwise two quick taps
   * on + both read the same stale value and count as one.
   */
  zoomBy: (step: number) => void;
  setShowNotes: (on: boolean) => void;

  /** A PDF, or one or more pictures that become the pages of one score. */
  importFiles: (files: File[]) => Promise<void>;
  openScore: (id: string) => Promise<void>;
  deleteScore: (id: string) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  closeScore: () => void;

  /**
   * Set a staff's clef. By default it applies to the same staff of every
   * system, because a score's layout repeats — the tenor line is the top staff
   * all the way through. Returns how many staves changed, so the UI can offer
   * to narrow it back to one.
   */
  setStaffClef: (staffId: string, clef: ClefId, scope?: 'all' | 'one') => number;
  /** Set several staves at once — how "only this staff" undoes a score-wide change. */
  applyClefs: (clefs: Record<string, ClefId>) => void;
  /**
   * Change the key. With `from` given, only the staves currently in that key
   * change — so correcting the key of one section of a score that modulates
   * leaves the other sections alone.
   */
  setSharps: (sharps: number, from?: number) => void;
  /** Set the key on one staff, for a score that changes key partway. */
  setStaffSharps: (staffId: string, sharps: number) => void;
  select: (noteId: string | null) => void;
  setVisiblePage: (page: number) => void;
  nudgeSelected: (steps: number) => void;
  resetNudges: () => void;
  /** Add a note the reader missed, at a point on a staff. */
  addNoteAt: (page: number, staffId: string, x: number, y: number) => DetectedNote | null;
  /** Take away a note that is not on the page. */
  removeNote: (noteId: string) => void;
  /**
   * Say what accidental is printed on a note, overriding what was read there.
   * `null` means none is — which is a different statement from saying nothing,
   * and is how a sharp the detector imagined gets taken back off.
   */
  setAlter: (noteId: string, alter: Alter) => void;

  /** Choose the part to look at, tag into and play. Null is the whole score. */
  setCurrentPart: (partId: string | null) => void;
  /** Turn tagging on or off. Turning it on with no part chosen chooses the first. */
  setTagging: (on: boolean) => void;
  /** Put notes in a part, or with `null`, take them out of the one they are in. */
  assignPart: (noteIds: string[], partId: string | null) => void;
  renamePart: (partId: string, name: string) => void;
  /** Take every note out of one part, and say how many that was. */
  clearPart: (partId: string) => number;
  /**
   * A first pass at the whole score, from the way it is laid out on the page:
   * one part per staff where there are staves enough, otherwise the voices of
   * each staff split top to bottom. It is a starting point to correct, not a
   * reading — which is why it says how many notes it moved and can be undone.
   */
  autoAssignParts: () => number;
  /** Put every assignment back as it was — how auto-assign is undone. */
  restorePartOf: (partOf: Record<string, string>) => void;

  sound: (midi: number) => void;
  soundNote: (note: DetectedNote) => void;
}

/**
 * Saving, but not on every frame.
 *
 * A score record carries its page images, so writing one is megabytes. That is
 * nothing once a note, and far too much once a pointer move — and dragging a
 * part along a line does exactly that. So the fast-moving edits coalesce, and
 * anything that could lose them (closing the score, leaving the tab) flushes
 * first.
 */
let pending: PageScore | null = null;
let pendingTimer: number | undefined;

const persist = (score: PageScore | null) => {
  // Whatever was queued is older than this, by definition — every write carries
  // the whole score. Letting a queued one fire afterwards would put the older
  // copy back, and a change made just before this one would silently return.
  pending = null;
  window.clearTimeout(pendingTimer);
  if (score) void db.scores.put(score);
};

const persistSoon = (score: PageScore | null) => {
  if (!score) return;
  pending = score;
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(flushPersist, 500);
};

const flushPersist = () => {
  window.clearTimeout(pendingTimer);
  const score = pending;
  pending = null;
  if (score) persist(score);
};

if (typeof window !== 'undefined') {
  // A phone backgrounds a tab by freezing it, and pagehide may be the last
  // thing that runs. Whatever is still only in memory goes down with it.
  window.addEventListener('pagehide', flushPersist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersist();
  });
}

/** Whether a stored row is a score this version of the app can actually open. */
const readable = (s: PageScore | undefined): s is PageScore =>
  s != null && Array.isArray(s.pages) && Array.isArray(s.staves) && Array.isArray(s.notes);

/**
 * Fill in what a score saved by an earlier build has no field for. Reading a
 * record that was never written is how the app once went white, and every
 * release adds another chance to do it — so anything that comes off the disk
 * goes through here first.
 */
const hydrate = (s: PageScore): PageScore => ({
  ...s,
  nudges: s.nudges ?? {},
  alters: s.alters ?? {},
  parts: s.parts?.length ? s.parts : DEFAULT_PARTS.map((p) => ({ ...p })),
  partOf: s.partOf ?? {},
  staves: (s.staves ?? []).map((st) => ({ ...st, bars: st.bars ?? [] })),
});

export const useApp = create<AppState>((set, get) => ({
  view: 'library',
  theme: 'system',

  score: null,
  library: [],
  loading: false,
  progress: null,
  error: null,

  instrument: 'piano',
  volume: 0.9,
  zoom: 1,
  showNotes: true,

  selected: null,
  ringing: [],
  visiblePage: 0,

  currentPart: null,
  tagging: false,

  setView: (view) => set({ view }),
  setTheme: (theme) => {
    set({ theme });
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    void db.settings.put({ key: 'theme', value: theme });
  },
  setInstrument: (instrument) => {
    player.instrument = instrument;
    set({ instrument });
    void db.settings.put({ key: 'instrument', value: instrument });
  },
  setVolume: (volume) => {
    player.setVolume(volume);
    set({ volume });
    void db.settings.put({ key: 'volume', value: volume });
  },
  setZoom: (zoom) => set({ zoom: Math.min(3, Math.max(0.6, zoom)) }),
  zoomBy: (step) =>
    set({
      zoom: Math.min(3, Math.max(0.6, Math.round((get().zoom + step) * 100) / 100)),
    }),
  setShowNotes: (showNotes) => set({ showNotes }),

  importFiles: async (files) => {
    if (!files.length) return;
    set({
      loading: true,
      error: null,
      progress: { label: 'Opening…', fraction: 0 },
    });
    try {
      const score = await importScore(files, (label, fraction) =>
        set({ progress: { label, fraction } }),
      );
      await db.scores.put(score);
      set({
        score,
        view: 'sheet',
        loading: false,
        progress: null,
        selected: null,
        currentPart: null,
        tagging: false,
      });
      await get().refreshLibrary();
    } catch (e) {
      set({
        loading: false,
        progress: null,
        error: e instanceof Error ? e.message : 'That file could not be read.',
      });
    }
  },

  openScore: async (id) => {
    const score = await db.scores.get(id).catch(() => undefined);
    if (!readable(score)) {
      await db.scores.delete(id).catch(() => undefined);
      await get().refreshLibrary();
      set({
        error: 'That score was saved by an older version of ClefNotes. Import the PDF again.',
      });
      return;
    }
    const opened = { ...hydrate(score), openedAt: Date.now() };
    await db.scores.put(opened);
    set({
      score: opened,
      view: 'sheet',
      selected: null,
      error: null,
      currentPart: null,
      tagging: false,
    });
    await get().refreshLibrary();
  },

  deleteScore: async (id) => {
    // Anything still waiting to be written is written first, so a delayed save
    // cannot land after the delete and resurrect the score.
    flushPersist();
    await db.scores.delete(id);
    if (get().score?.id === id) set({ score: null, view: 'library', currentPart: null });
    await get().refreshLibrary();
  },

  refreshLibrary: async () => {
    const rows = await db.scores
      .orderBy('openedAt')
      .reverse()
      .toArray()
      .catch(() => []);
    const usable = rows.filter(readable);
    // Scores saved by an earlier version of ClefNotes describe a rebuilt score
    // rather than a page you can click, and there is nothing in them to convert
    // — the page images they would need were never stored. Left in place they
    // are worse than useless: the shelf reads their page count and takes the
    // whole app down with it. So they are dropped, and the PDF re-imported.
    const stale = rows.filter((r) => !readable(r));
    if (stale.length) await db.scores.bulkDelete(stale.map((r) => r.id)).catch(() => undefined);
    set({ library: usable });
  },

  closeScore: () => {
    flushPersist();
    set({ score: null, view: 'library', selected: null, currentPart: null, tagging: false });
  },

  setStaffClef: (staffId, clef, scope = 'all') => {
    const score = get().score;
    if (!score) return 0;
    const target = score.staves.find((s) => s.id === staffId);
    if (!target) return 0;
    const hit = (s: (typeof score.staves)[number]) =>
      scope === 'one' ? s.id === staffId : s.positionInSystem === target.positionInSystem;

    const staves = score.staves.map((s) => (hit(s) ? { ...s, clef } : s));
    const changed = staves.filter((s, i) => s.clef !== score.staves[i].clef).length;
    const next = { ...score, staves };
    set({ score: next });
    persist(next);
    return changed;
  },

  applyClefs: (clefs) => {
    const score = get().score;
    if (!score) return;
    const next = {
      ...score,
      staves: score.staves.map((s) => (clefs[s.id] ? { ...s, clef: clefs[s.id] } : s)),
    };
    set({ score: next });
    persist(next);
  },

  setSharps: (sharps, from) => {
    const score = get().score;
    if (!score) return;
    // Staves carry their own key, so this has to reach them too, or the control
    // would appear to do nothing. Restricting it to the staves already in the
    // key being shown is what keeps a modulation intact: retuning the verse
    // should not silently rewrite the key change that follows it.
    const hit = (s: (typeof score.staves)[number]) => from == null || s.sharps === from;
    const next = {
      ...score,
      sharps: from == null || score.sharps === from ? sharps : score.sharps,
      staves: score.staves.map((s) => (hit(s) ? { ...s, sharps } : s)),
    };
    set({ score: next });
    persist(next);
  },

  setStaffSharps: (staffId, sharps) => {
    const score = get().score;
    if (!score) return;
    const next = {
      ...score,
      staves: score.staves.map((s) => (s.id === staffId ? { ...s, sharps } : s)),
    };
    set({ score: next });
    persist(next);
  },

  select: (selected) => set({ selected }),
  setVisiblePage: (visiblePage) => {
    if (get().visiblePage !== visiblePage) set({ visiblePage });
  },

  /** Move the selected note up or down the staff, and sound the result. */
  nudgeSelected: (steps) => {
    const { score, selected } = get();
    if (!score || !selected) return;
    const next = {
      ...score,
      nudges: {
        ...score.nudges,
        [selected]: (score.nudges[selected] ?? 0) + steps,
      },
    };
    set({ score: next });
    persist(next);
    const note = next.notes.find((n) => n.id === selected);
    const staff = note && next.staves.find((s) => s.id === note.staff);
    if (note && staff) get().sound(noteMidi(note, staff, next));
  },

  setAlter: (noteId, alter) => {
    const score = get().score;
    if (!score) return;
    const next = { ...score, alters: { ...score.alters, [noteId]: alter } };
    set({ score: next });
    persist(next);
    const note = next.notes.find((n) => n.id === noteId);
    const staff = note && next.staves.find((s) => s.id === note.staff);
    if (note && staff) get().sound(noteMidi(note, staff, next));
  },

  /**
   * Put a note where the reader did not find one.
   *
   * Recognition will always miss something, and until now a miss was permanent:
   * you could hear the pitch by holding a finger on the spot, but the note was
   * not there to click, not there in a glide, and not there tomorrow. One tap
   * is a cheaper repair than any amount of further tuning could buy, and it
   * cannot be wrong — you are looking straight at the page.
   */
  addNoteAt: (page, staffId, x, y) => {
    const score = get().score;
    if (!score) return null;
    const staff = score.staves.find((s) => s.id === staffId);
    if (!staff) return null;
    const note: DetectedNote = {
      id: `${staffId}u${Date.now().toString(36)}`,
      page,
      staff: staffId,
      x,
      // On the line or space it belongs to, not on the pixel you touched.
      y: staff.lines[4] - stepAt(staff, y) * (staff.spacing / 2),
      step: stepAt(staff, y),
      filled: true,
      confidence: 1,
      accidental: null,
    };
    // Put in while tagging a part, it joins that part — you were pointing at a
    // hole in that line, and having to go back and tap it again would be a
    // second repair for one mistake.
    const { currentPart, tagging } = get();
    const next = {
      ...score,
      notes: [...score.notes, note].sort((a, b) => a.x - b.x),
      partOf:
        tagging && currentPart
          ? { ...(score.partOf ?? {}), [note.id]: currentPart }
          : (score.partOf ?? {}),
    };
    set({ score: next, selected: note.id });
    persist(next);
    get().sound(noteMidi(note, staff, next));
    return note;
  },

  /**
   * Take away a note that is not on the page. Its corrections go with it —
   * leaving them behind would silently reattach them to a later note that
   * happened to be given the same id.
   */
  removeNote: (noteId) => {
    const score = get().score;
    if (!score) return;
    const nudges = { ...score.nudges };
    const alters = { ...score.alters };
    const partOf = { ...(score.partOf ?? {}) };
    delete nudges[noteId];
    delete alters[noteId];
    delete partOf[noteId];
    const next = {
      ...score,
      notes: score.notes.filter((n) => n.id !== noteId),
      nudges,
      alters,
      partOf,
    };
    set({ score: next, selected: null });
    persist(next);
  },

  resetNudges: () => {
    const score = get().score;
    if (!score) return;
    const next = { ...score, nudges: {} };
    set({ score: next });
    persist(next);
  },

  setCurrentPart: (currentPart) =>
    set({ currentPart, tagging: currentPart == null ? false : get().tagging }),

  setTagging: (on) => {
    const score = get().score;
    if (!on) return set({ tagging: false });
    // Tagging with nowhere to put the note is a mode that cannot do anything,
    // so asking for it chooses the first part rather than refusing.
    const currentPart = get().currentPart ?? (score ? scoreParts(score)[0]?.id : null) ?? null;
    set({ tagging: currentPart != null, currentPart });
  },

  assignPart: (noteIds, partId) => {
    const score = get().score;
    if (!score || !noteIds.length) return;
    const partOf = { ...(score.partOf ?? {}) };
    let changed = false;
    for (const id of noteIds) {
      if (partId == null) {
        if (id in partOf) {
          delete partOf[id];
          changed = true;
        }
      } else if (partOf[id] !== partId) {
        partOf[id] = partId;
        changed = true;
      }
    }
    if (!changed) return;
    const next = { ...score, partOf };
    set({ score: next });
    persistSoon(next);
  },

  renamePart: (partId, name) => {
    const score = get().score;
    if (!score) return;
    const next = {
      ...score,
      parts: scoreParts(score).map((p) => (p.id === partId ? { ...p, name } : p)),
    };
    set({ score: next });
    persistSoon(next);
  },

  clearPart: (partId) => {
    const score = get().score;
    if (!score) return 0;
    const partOf: Record<string, string> = {};
    let cleared = 0;
    for (const [id, p] of Object.entries(score.partOf ?? {})) {
      if (p === partId) cleared++;
      else partOf[id] = p;
    }
    if (!cleared) return 0;
    const next = { ...score, partOf };
    set({ score: next });
    persist(next);
    return cleared;
  },

  autoAssignParts: () => {
    const score = get().score;
    if (!score) return 0;
    const parts = scoreParts(score);
    /**
     * How many staves a system has, which is how the layout says the parts are
     * divided. Four staves and four parts is one part per staff; two staves and
     * four parts is two voices on each, upper and lower — which is how a hymn
     * or a barbershop chart is printed, and the reason this is worth doing at
     * all rather than asking for a thousand taps.
     */
    const rows = score.staves.reduce((n, s) => Math.max(n, s.positionInSystem + 1), 1);
    const perStaff = Math.max(1, Math.ceil(parts.length / rows));

    const onStaff = new Map<string, DetectedNote[]>();
    for (const n of score.notes) {
      if (!onStaff.has(n.staff)) onStaff.set(n.staff, []);
      onStaff.get(n.staff)!.push(n);
    }

    const partOf: Record<string, string> = {};
    for (const staff of score.staves) {
      const notes = (onStaff.get(staff.id) ?? []).slice().sort((a, b) => a.x - b.x);
      // Noteheads stacked at one moment are one chord, and its voices run top
      // to bottom — the same grouping a glide uses to sound a line rather than
      // a wash.
      let column: DetectedNote[] = [];
      const settle = () => {
        if (!column.length) return;
        const stacked = column.slice().sort((a, b) => a.y - b.y);
        stacked.forEach((n, i) => {
          const slot = Math.min(i, perStaff - 1);
          const index = Math.min(parts.length - 1, staff.positionInSystem * perStaff + slot);
          partOf[n.id] = parts[index].id;
        });
        column = [];
      };
      for (const n of notes) {
        if (column.length && Math.abs(n.x - column[0].x) >= staff.spacing * 0.8) settle();
        column.push(n);
      }
      settle();
    }

    const next = { ...score, parts, partOf };
    set({ score: next });
    persist(next);
    return Object.keys(partOf).length;
  },

  restorePartOf: (partOf) => {
    const score = get().score;
    if (!score) return;
    const next = { ...score, partOf: { ...partOf } };
    set({ score: next });
    persist(next);
  },

  sound: (midi) => {
    void player.play(midi);
    set({ ringing: [...get().ringing.slice(-8), midi] });
    window.setTimeout(() => set({ ringing: player.sounding() }), 1200);
  },

  soundNote: (note) => {
    const score = get().score;
    if (!score) return;
    const staff = score.staves.find((s) => s.id === note.staff);
    if (!staff) return;
    get().sound(noteMidi(note, staff, score));
  },
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __cn: typeof useApp }).__cn = useApp;
  (window as unknown as { __player: typeof player }).__player = player;
}

/** Restore preferences. */
void (async () => {
  try {
    const rows = await db.settings.toArray();
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    const theme = (get('theme') as 'light' | 'dark' | 'system') ?? 'system';
    useApp.getState().setTheme(theme);
    // Only honour a remembered instrument that still exists — an older version
    // had a singing voice, and restoring a preset that is no longer there would
    // leave the app silent with no way to tell why.
    const instrument = get('instrument') as InstrumentId | undefined;
    if (instrument && INSTRUMENTS[instrument]) useApp.getState().setInstrument(instrument);
    const volume = get('volume') as number | undefined;
    if (typeof volume === 'number') useApp.getState().setVolume(volume);
  } catch {
    /* private mode: defaults are fine */
  }
  await useApp.getState().refreshLibrary();
})();
