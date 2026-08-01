import { create } from 'zustand';
import Dexie, { type Table } from 'dexie';
import { player } from '../lib/audio/player';
import type { InstrumentId } from '../lib/audio/instruments';
import { importPdf } from '../lib/detect/pdf';
import { noteMidi, type ClefId, type DetectedNote, type PageScore } from '../lib/detect/types';

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

  setView: (v: ViewId) => void;
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  setInstrument: (i: InstrumentId) => void;
  setVolume: (v: number) => void;
  setZoom: (z: number) => void;
  setShowNotes: (on: boolean) => void;

  importFile: (file: File) => Promise<void>;
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
  setSharps: (sharps: number) => void;
  select: (noteId: string | null) => void;
  setVisiblePage: (page: number) => void;
  nudgeSelected: (steps: number) => void;
  resetNudges: () => void;

  sound: (midi: number) => void;
  soundNote: (note: DetectedNote) => void;
}

const persist = (score: PageScore | null) => {
  if (score) void db.scores.put(score);
};

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
  setZoom: (zoom) => set({ zoom }),
  setShowNotes: (showNotes) => set({ showNotes }),

  importFile: async (file) => {
    set({ loading: true, error: null, progress: { label: 'Opening…', fraction: 0 } });
    try {
      const score = await importPdf(file, (label, fraction) => set({ progress: { label, fraction } }));
      await db.scores.put(score);
      set({ score, view: 'sheet', loading: false, progress: null, selected: null });
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
    const score = await db.scores.get(id);
    if (!score) return;
    const opened = { ...score, openedAt: Date.now() };
    await db.scores.put(opened);
    set({ score: opened, view: 'sheet', selected: null, error: null });
    await get().refreshLibrary();
  },

  deleteScore: async (id) => {
    await db.scores.delete(id);
    if (get().score?.id === id) set({ score: null, view: 'library' });
    await get().refreshLibrary();
  },

  refreshLibrary: async () => {
    const rows = await db.scores.orderBy('openedAt').reverse().toArray().catch(() => []);
    set({ library: rows });
  },

  closeScore: () => set({ score: null, view: 'library', selected: null }),

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

  setSharps: (sharps) => {
    const score = get().score;
    if (!score) return;
    const next = { ...score, sharps };
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
      nudges: { ...score.nudges, [selected]: (score.nudges[selected] ?? 0) + steps },
    };
    set({ score: next });
    persist(next);
    const note = next.notes.find((n) => n.id === selected);
    const staff = note && next.staves.find((s) => s.id === note.staff);
    if (note && staff) get().sound(noteMidi(note, staff, next));
  },

  resetNudges: () => {
    const score = get().score;
    if (!score) return;
    const next = { ...score, nudges: {} };
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
    const instrument = get('instrument') as InstrumentId | undefined;
    if (instrument) useApp.getState().setInstrument(instrument);
    const volume = get('volume') as number | undefined;
    if (typeof volume === 'number') useApp.getState().setVolume(volume);
  } catch {
    /* private mode: defaults are fine */
  }
  await useApp.getState().refreshLibrary();
})();
