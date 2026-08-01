import { create } from 'zustand';
import type { Score } from '../lib/score/types';
import { engine, DEFAULT_TRANSPORT, type PartMix, type TransportState } from '../lib/audio/engine';
import { engrave, DEFAULT_ENGRAVE, type EngraveOptions } from '../lib/verovio/engraver';
import { applyPack, suggestInstrument, type InstrumentId, type SoundPack } from '../lib/audio/instruments';
import { suggestVoice } from '../lib/audio/clefvox';
import {
  barsForScore,
  db,
  getSetting,
  heatOf,
  logSession,
  recordBars,
  setSetting,
  streakInfo,
  type BarStat,
  type StoredScore,
  type StreakInfo,
} from '../lib/db/db';
import {
  ACHIEVEMENTS,
  DEFAULT_DAILY_GOAL_MIN,
  EMPTY_PROGRESS,
  evaluate,
  type ProgressCounters,
} from '../lib/progress/achievements';
import { SHELF, shelfXml } from '../data/scores/shelf';
import { transposePart, type EditResult, type EditTarget } from '../lib/score/edit';

export type ViewId = 'library' | 'studio' | 'lab' | 'vox' | 'import';
export type ScoreViewMode = 'sheet' | 'roll' | 'split';

interface AppState {
  view: ViewId;
  scoreMode: ScoreViewMode;
  theme: 'light' | 'dark' | 'system';
  /**
   * Simple mode shows only the controls a first-timer needs. Everything else
   * is one tap away — the app has a lot in it, and meeting someone with all of
   * it at once is how you lose them before they hear a note.
   */
  simpleMode: boolean;

  score: Score | null;
  svg: string;
  loading: boolean;
  loadingLabel: string;
  error: string | null;

  mixes: PartMix[];
  transport: TransportState;
  engraveOpts: EngraveOptions;
  packId: string;

  /** Live playhead position, updated each animation frame. */
  q: number;

  library: StoredScore[];
  bars: Map<number, BarStat>;
  streak: StreakInfo | null;

  /** Step mode parks on one note at a time instead of running. */
  stepMode: boolean;
  /** Bar range selected for looping, 1-based and inclusive. */
  loopBars: [number, number] | null;
  /** Tempo ramp progress, when a ramp is running. */
  ramp: { from: number; to: number; step: number; current: number; passes: number } | null;

  /** Progress, achievements and the daily goal. */
  progress: ProgressCounters;
  unlocked: string[];
  dailyGoalMin: number;
  /** Achievements just earned, shown as toasts then dismissed. */
  toasts: Array<{ id: string; name: string; hint: string; ink: string }>;

  /** Note editing. */
  editing: boolean;
  selected: EditTarget | null;
  editStatus: string | null;
  /** Previous versions of the MusicXML, newest last. */
  undoStack: string[];
  /** Written transposition applied per part, for transposing instruments. */
  writtenTranspose: Record<number, number>;

  setView: (v: ViewId) => void;
  setScoreMode: (m: ScoreViewMode) => void;
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  setSimpleMode: (on: boolean) => void;

  loadScore: (musicXml: string, meta: { source: string; slug?: string; id?: string }) => Promise<void>;
  reEngrave: (opts: Partial<EngraveOptions>) => Promise<void>;

  setMix: (index: number, patch: Partial<PartMix>) => void;
  setAllMixes: (mixes: PartMix[]) => void;
  applySoundPack: (pack: SoundPack) => void;
  soloOnly: (index: number | null) => void;
  minusOne: (index: number) => void;

  patchTransport: (patch: Partial<TransportState>) => void;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seekQ: (q: number) => void;
  seekBar: (measure: number) => void;
  stepBy: (delta: number) => Promise<void>;
  setStepMode: (on: boolean) => void;

  setLoopBars: (range: [number, number] | null) => void;
  startRamp: (from: number, to: number, step: number) => void;
  rampPass: () => void;
  clearRamp: () => void;

  bump: (patch: Partial<ProgressCounters> | ((p: ProgressCounters) => Partial<ProgressCounters>)) => void;
  checkAchievements: () => Promise<void>;
  dismissToast: (id: string) => void;
  setDailyGoal: (minutes: number) => void;

  setEditing: (on: boolean) => void;
  selectNote: (target: EditTarget | null) => void;
  moveSelection: (delta: number) => void;
  applyEdit: (fn: (score: Score, target: EditTarget) => EditResult) => Promise<void>;
  transposePartWritten: (partIndex: number, semitones: number) => Promise<void>;
  applyScoreEdit: (fn: (musicXml: string) => EditResult) => Promise<void>;
  undoEdit: () => Promise<void>;

  refreshLibrary: () => Promise<void>;
  refreshStats: () => Promise<void>;
  deleteScore: (id: string) => Promise<void>;
  seedShelf: () => Promise<void>;
}

function defaultMix(medianMidi: number, hasLyrics: boolean, index: number, total: number): PartMix {
  return {
    instrument: suggestInstrument(medianMidi, hasLyrics),
    volume: 0.85,
    pan: total > 1 ? (index / Math.max(1, total - 1)) * 0.5 - 0.25 : 0,
    muted: false,
    solo: false,
    transpose: 0,
    voiceType: suggestVoice(medianMidi),
  };
}

/** Session accounting: we only count time the transport actually moved. */
let playStartedAt = 0;
let accumulatedSeconds = 0;
let barsTouched = new Set<number>();

export const useApp = create<AppState>((set, get) => ({
  view: 'library',
  scoreMode: 'sheet',
  theme: 'system',
  simpleMode: true,

  score: null,
  svg: '',
  loading: false,
  loadingLabel: '',
  error: null,

  mixes: [],
  transport: { ...DEFAULT_TRANSPORT },
  engraveOpts: { ...DEFAULT_ENGRAVE },
  packId: 'choral',

  q: 0,

  library: [],
  bars: new Map(),
  streak: null,

  stepMode: false,
  loopBars: null,
  ramp: null,

  progress: { ...EMPTY_PROGRESS },
  unlocked: [],
  dailyGoalMin: DEFAULT_DAILY_GOAL_MIN,
  toasts: [],

  editing: false,
  selected: null,
  editStatus: null,
  undoStack: [],
  writtenTranspose: {},

  setView: (view) => set({ view }),
  setScoreMode: (scoreMode) => set({ scoreMode }),
  setSimpleMode: (on) => {
    set({ simpleMode: on });
    void setSetting('simpleMode', on);
  },
  setTheme: (theme) => {
    set({ theme });
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    void setSetting('theme', theme);
  },

  loadScore: async (musicXml, meta) => {
    set({ loading: true, loadingLabel: 'Engraving the score…', error: null });
    try {
      const { svg, score } = await engrave(musicXml, get().engraveOpts);
      const id = meta.id ?? `${meta.slug ?? 'score'}-${Date.now().toString(36)}`;
      const full: Score = { ...score, id, source: meta.source as Score['source'] };

      // Reuse the mixer state from last time if we have seen this score before.
      const stored = await db.scores.get(id).catch(() => undefined);
      const mixes =
        stored?.mixes && stored.mixes.length === full.parts.length
          ? stored.mixes
          : full.parts.map((p, i) => defaultMix(p.medianMidi, p.hasLyrics, i, full.parts.length));

      const bpm = stored?.bpm ?? full.bpm;
      engine.setScore(full, mixes);
      engine.patch({
        ...DEFAULT_TRANSPORT,
        bpm,
        loopEndQ: full.totalQ,
        reverb: get().transport.reverb,
        masterVolume: get().transport.masterVolume,
      });

      await db.scores.put({
        id,
        title: full.title,
        composer: full.composer,
        musicXml,
        source: meta.source,
        slug: meta.slug,
        addedAt: stored?.addedAt ?? Date.now(),
        openedAt: Date.now(),
        partCount: full.parts.length,
        measureCount: full.measureCount,
        tags: stored?.tags ?? [],
        mixes,
        bpm,
      });

      const bars = await barsForScore(id);
      set({
        score: full,
        svg,
        mixes,
        bars,
        transport: engine.getState(),
        q: 0,
        loading: false,
        loadingLabel: '',
        view: 'studio',
        loopBars: null,
        ramp: null,
        writtenTranspose: {},
        undoStack: [],
      });
      barsTouched = new Set();
      accumulatedSeconds = 0;
      void get().refreshLibrary();
    } catch (e) {
      set({
        loading: false,
        loadingLabel: '',
        error: e instanceof Error ? e.message : 'That score could not be read.',
      });
    }
  },

  reEngrave: async (opts) => {
    const { score, engraveOpts } = get();
    if (!score) return;
    const next = { ...engraveOpts, ...opts };
    set({ engraveOpts: next, loading: true, loadingLabel: 'Re-laying out…' });
    try {
      const { svg } = await engrave(score.musicXml, next);
      set({ svg, loading: false, loadingLabel: '' });
    } catch {
      set({ loading: false, loadingLabel: '' });
    }
  },

  setMix: (index, patch) => {
    const mixes = get().mixes.map((m, i) => (i === index ? { ...m, ...patch } : m));
    engine.setMixes(mixes);
    set({ mixes });
    const id = get().score?.id;
    if (id) void db.scores.update(id, { mixes });
  },

  setAllMixes: (mixes) => {
    engine.setMixes(mixes);
    set({ mixes });
    const id = get().score?.id;
    if (id) void db.scores.update(id, { mixes });
  },

  applySoundPack: (pack) => {
    const { score } = get();
    if (!score) return;
    const instruments = applyPack(pack, score.parts);
    const mixes = get().mixes.map((m, i) => ({ ...m, instrument: instruments[i] as InstrumentId }));
    engine.setMixes(mixes);
    engine.patch({ reverb: pack.reverb, swing: pack.swing ?? 0 });
    set({ mixes, packId: pack.id, transport: engine.getState() });
    const id = score.id;
    void db.scores.update(id, { mixes });
    get().bump((p) => ({
      packsTried: p.packsTried.includes(pack.id) ? p.packsTried : [...p.packsTried, pack.id],
    }));
  },

  soloOnly: (index) => {
    const mixes = get().mixes.map((m, i) => ({ ...m, solo: index != null && i === index, muted: false }));
    engine.setMixes(mixes);
    set({ mixes });
  },

  /** Mute your own part and let the rest of the ensemble play around you. */
  minusOne: (index) => {
    const mixes = get().mixes.map((m, i) => ({ ...m, muted: i === index, solo: false }));
    engine.setMixes(mixes);
    set({ mixes });
    get().bump((p) => ({ minusOneUses: p.minusOneUses + 1 }));
  },

  patchTransport: (patch) => {
    engine.patch(patch);
    set({ transport: engine.getState() });
  },

  play: async () => {
    const { score, stepMode } = get();
    if (!score || stepMode) return;
    playStartedAt = performance.now();
    await engine.play();
    set({ transport: engine.getState() });
    get().bump((p) => ({ playCount: p.playCount + 1 }));
  },

  pause: () => {
    engine.pause();
    if (playStartedAt) {
      const elapsed = (performance.now() - playStartedAt) / 1000;
      accumulatedSeconds += elapsed;
      // Time spent under 70% speed is the practice that actually fixes things.
      if (get().transport.rate <= 0.7) {
        get().bump((p) => ({ slowSeconds: p.slowSeconds + elapsed }));
      }
      playStartedAt = 0;
    }
    set({ transport: engine.getState() });
    void get().refreshStats();
  },

  stop: () => {
    engine.stop();
    if (playStartedAt) {
      accumulatedSeconds += (performance.now() - playStartedAt) / 1000;
      playStartedAt = 0;
    }
    const id = get().score?.id;
    if (id && accumulatedSeconds > 3) {
      void logSession(id, accumulatedSeconds, barsTouched.size).then(() => get().refreshStats());
      void recordBars(id, Array.from(barsTouched), {
        looped: get().transport.loop,
        bpm: Math.round(get().transport.bpm * get().transport.rate),
      }).then(() => get().refreshStats());
      accumulatedSeconds = 0;
      barsTouched = new Set();
    }
    set({ transport: engine.getState(), q: engine.getState().q });
  },

  seekQ: (q) => {
    engine.seek(q);
    set({ q, transport: engine.getState() });
  },

  seekBar: (measure) => {
    const { score } = get();
    const m = score?.measureQ.get(measure);
    if (!m) return;
    get().seekQ(m.start);
  },

  /** Walk one note at a time — the sight-reading crutch that actually helps. */
  stepBy: async (delta) => {
    const { score, q } = get();
    if (!score) return;
    const audible = score.notes.filter((n) => {
      const mix = get().mixes[n.part];
      const anySolo = get().mixes.some((m) => m.solo);
      return anySolo ? mix?.solo : !mix?.muted;
    });
    if (!audible.length) return;

    const positions = Array.from(new Set(audible.map((n) => Number(n.q.toFixed(4))))).sort((a, b) => a - b);
    let idx = positions.findIndex((p) => p > q + 1e-4);
    if (delta > 0) {
      if (idx < 0) idx = positions.length - 1;
    } else {
      const before = positions.filter((p) => p < q - 1e-4);
      idx = before.length ? positions.indexOf(before[before.length - 1]) : 0;
    }
    const target = positions[Math.max(0, Math.min(positions.length - 1, idx))];
    set({ q: target });
    engine.seek(target);

    const chord = audible.filter((n) => Math.abs(n.q - target) < 1e-4);
    for (const n of chord) {
      await engine.preview(n.midi, n.part, Math.min(1.2, n.qDur * 0.6 + 0.35), n.syllable);
    }
    barsTouched.add(chord[0]?.measure ?? 1);
  },

  setStepMode: (on) => {
    if (on) engine.pause();
    set({ stepMode: on, transport: engine.getState() });
  },

  setLoopBars: (range) => {
    const { score } = get();
    if (!score || !range) {
      engine.patch({ loop: false, loopStartQ: 0, loopEndQ: score?.totalQ ?? 0 });
      set({ loopBars: null, transport: engine.getState() });
      return;
    }
    const [a, b] = range[0] <= range[1] ? range : [range[1], range[0]];
    const start = score.measureQ.get(a)?.start ?? 0;
    const endBar = score.measureQ.get(b);
    const end = endBar ? endBar.start + endBar.length : score.totalQ;
    engine.patch({ loop: true, loopStartQ: start, loopEndQ: end });
    set({ loopBars: [a, b], transport: engine.getState() });
  },

  /**
   * Tempo ramp: each clean pass unlocks the next rung. The mechanic is
   * borrowed from rhythm games, pointed at a real instrument.
   */
  startRamp: (from, to, step) => {
    get().patchTransport({ bpm: from, loop: true });
    set({ ramp: { from, to, step, current: from, passes: 0 } });
  },

  rampPass: () => {
    const ramp = get().ramp;
    if (!ramp) return;
    const next = Math.min(ramp.to, Math.round(ramp.current * (1 + ramp.step / 100)));
    get().patchTransport({ bpm: next });
    set({ ramp: { ...ramp, current: next, passes: ramp.passes + 1 } });
    get().bump((p) => ({
      loopPasses: p.loopPasses + 1,
      rampsCompleted: next >= ramp.to ? p.rampsCompleted + 1 : p.rampsCompleted,
    }));
  },

  clearRamp: () => set({ ramp: null }),

  bump: (patch) => {
    const current = get().progress;
    const delta = typeof patch === 'function' ? patch(current) : patch;
    const next = { ...current, ...delta };
    set({ progress: next });
    void setSetting('progress', next);
    void get().checkAchievements();
  },

  /**
   * Re-evaluate every achievement and toast anything newly earned.
   * Cheap enough to run on any change, which means an unlock always lands the
   * moment it is deserved rather than on the next reload.
   */
  checkAchievements: async () => {
    const { progress, streak, library, bars, unlocked } = get();
    const cleanBars = Array.from(bars.values()).filter((b) => heatOf(b) === 'clean').length;
    const results = evaluate({ progress, streak, libraryCount: library.length, cleanBars });
    const nowUnlocked = results.filter((r) => r.unlocked).map((r) => r.achievement.id);
    const fresh = nowUnlocked.filter((id) => !unlocked.includes(id));
    if (!fresh.length) return;

    const toasts = fresh
      .map((id) => ACHIEVEMENTS.find((a) => a.id === id))
      .filter((a): a is (typeof ACHIEVEMENTS)[number] => !!a)
      .map((a) => ({ id: a.id, name: a.name, hint: a.hint, ink: a.ink }));

    const merged = [...unlocked, ...fresh];
    set({ unlocked: merged, toasts: [...get().toasts, ...toasts] });
    await setSetting('unlocked', merged);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setDailyGoal: (minutes) => {
    set({ dailyGoalMin: minutes });
    void setSetting('dailyGoalMin', minutes);
  },

  setEditing: (on) => {
    if (on) engine.pause();
    set({ editing: on, selected: null, editStatus: null, transport: engine.getState() });
  },

  selectNote: (target) => set({ selected: target }),

  moveSelection: (delta) => {
    const { score, selected } = get();
    if (!score) return;
    if (!selected) {
      const first = score.notes.find((n) => n.part === 0);
      if (first) set({ selected: { part: first.part, ordinal: first.ordinal } });
      return;
    }
    const inPart = score.notes
      .filter((n) => n.part === selected.part)
      .sort((a, b) => a.ordinal - b.ordinal);
    const next = Math.max(0, Math.min(inPart.length - 1, selected.ordinal + delta));
    const note = inPart[next];
    if (!note) return;
    set({ selected: { part: selected.part, ordinal: next } });
    engine.seek(note.q);
    void engine.preview(note.midi, note.part, 0.4, note.syllable);
  },

  /**
   * Run an edit, re-engrave, and keep the selection pointing at the same note.
   * The previous XML goes on the undo stack first, so any change is reversible.
   */
  applyEdit: async (fn) => {
    const { score, selected } = get();
    if (!score || !selected) return;
    const previous = score.musicXml;
    try {
      const result = fn(score, selected);
      set({ loading: true, loadingLabel: 'Applying edit…' });
      const { svg, score: rebuilt } = await engrave(result.musicXml, get().engraveOpts);
      const full: Score = { ...rebuilt, id: score.id, source: score.source };
      engine.setScore(full, get().mixes);
      engine.patch({ bpm: get().transport.bpm, loopEndQ: full.totalQ });
      set({
        score: full,
        svg,
        loading: false,
        loadingLabel: '',
        editStatus: result.description,
        undoStack: [...get().undoStack.slice(-24), previous],
      });
      await db.scores.update(score.id, { musicXml: result.musicXml });
      get().bump((p) => ({ notesFixed: p.notesFixed + 1 }));

      // Audition the corrected note so the fix can be heard, not just seen.
      const note = full.notes.find((n) => n.part === selected.part && n.ordinal === selected.ordinal);
      if (note) {
        engine.seek(note.q);
        void engine.preview(note.midi, note.part, 0.5, note.syllable);
      }
    } catch (e) {
      set({
        loading: false,
        loadingLabel: '',
        editStatus: e instanceof Error ? e.message : 'That edit could not be applied.',
      });
    }
  },

  /**
   * Rewrite a part for a transposing instrument.
   *
   * A B♭ trumpeter reads a whole tone above concert pitch. So the notation is
   * transposed up, and the part's playback is transposed down by the same
   * amount to cancel it out — the player reads their own part and still hears
   * the piece in the key everyone else is in.
   */
  transposePartWritten: async (partIndex, semitones) => {
    const { score, mixes } = get();
    if (!score) return;
    const previous = score.musicXml;
    const currentWritten = get().writtenTranspose[partIndex] ?? 0;
    const delta = semitones - currentWritten;
    if (delta === 0) return;

    set({ loading: true, loadingLabel: 'Rewriting the part…' });
    try {
      const result = transposePart(score, partIndex, delta);
      const { svg, score: rebuilt } = await engrave(result.musicXml, get().engraveOpts);
      const full: Score = { ...rebuilt, id: score.id, source: score.source };
      const nextMixes = mixes.map((m, i) =>
        i === partIndex ? { ...m, transpose: m.transpose - delta } : m,
      );
      engine.setScore(full, nextMixes);
      engine.patch({ bpm: get().transport.bpm, loopEndQ: full.totalQ });
      set({
        score: full,
        svg,
        mixes: nextMixes,
        loading: false,
        loadingLabel: '',
        writtenTranspose: { ...get().writtenTranspose, [partIndex]: semitones },
        undoStack: [...get().undoStack.slice(-24), previous],
        editStatus: result.description,
      });
      await db.scores.update(score.id, { musicXml: result.musicXml, mixes: nextMixes });
    } catch (e) {
      set({
        loading: false,
        loadingLabel: '',
        editStatus: e instanceof Error ? e.message : 'That part could not be transposed.',
      });
    }
  },

  /** A whole-score edit — key, time signature — with re-engraving and undo. */
  applyScoreEdit: async (fn) => {
    const { score } = get();
    if (!score) return;
    const previous = score.musicXml;
    set({ loading: true, loadingLabel: 'Applying…' });
    try {
      const result = fn(score.musicXml);
      const { svg, score: rebuilt } = await engrave(result.musicXml, get().engraveOpts);
      const full: Score = { ...rebuilt, id: score.id, source: score.source };
      engine.setScore(full, get().mixes);
      engine.patch({ bpm: get().transport.bpm, loopEndQ: full.totalQ });
      set({
        score: full,
        svg,
        loading: false,
        loadingLabel: '',
        editStatus: result.description,
        undoStack: [...get().undoStack.slice(-24), previous],
      });
      await db.scores.update(score.id, { musicXml: result.musicXml });
    } catch (e) {
      set({
        loading: false,
        loadingLabel: '',
        editStatus: e instanceof Error ? e.message : 'That change could not be applied.',
      });
    }
  },

  undoEdit: async () => {
    const { score, undoStack } = get();
    if (!score || !undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    set({ loading: true, loadingLabel: 'Undoing…' });
    try {
      const { svg, score: rebuilt } = await engrave(previous, get().engraveOpts);
      const full: Score = { ...rebuilt, id: score.id, source: score.source };
      engine.setScore(full, get().mixes);
      engine.patch({ bpm: get().transport.bpm, loopEndQ: full.totalQ });
      set({
        score: full,
        svg,
        loading: false,
        loadingLabel: '',
        undoStack: undoStack.slice(0, -1),
        editStatus: 'Undone',
      });
      await db.scores.update(score.id, { musicXml: previous });
    } catch {
      set({ loading: false, loadingLabel: '', editStatus: 'Undo failed.' });
    }
  },

  refreshLibrary: async () => {
    try {
      const rows = await db.scores.orderBy('openedAt').reverse().toArray();
      set({ library: rows });
    } catch {
      set({ library: [] });
    }
  },

  refreshStats: async () => {
    const id = get().score?.id;
    const [streak, bars] = await Promise.all([
      streakInfo().catch(() => null),
      id ? barsForScore(id).catch(() => new Map<number, BarStat>()) : Promise.resolve(new Map<number, BarStat>()),
    ]);
    set({ streak, bars });
  },

  deleteScore: async (id) => {
    await db.scores.delete(id);
    await db.bars.where('scoreId').equals(id).delete();
    await get().refreshLibrary();
    if (get().score?.id === id) {
      engine.stop();
      set({ score: null, svg: '', view: 'library' });
    }
  },

  /** Put the shelf in the library the first time the app is opened. */
  seedShelf: async () => {
    const seeded = await getSetting('shelfSeeded', false);
    const count = await db.scores.count().catch(() => 0);
    if (seeded && count > 0) return;
    const now = Date.now();
    for (const [i, entry] of SHELF.entries()) {
      const id = `shelf-${entry.slug}`;
      const existing = await db.scores.get(id).catch(() => undefined);
      if (existing) continue;
      await db.scores.put({
        id,
        title: entry.spec.title,
        composer: entry.spec.composer ?? '',
        musicXml: shelfXml(entry),
        source: 'bundled',
        slug: entry.slug,
        addedAt: now - i,
        openedAt: now - i - 1000,
        partCount: entry.spec.parts.length,
        measureCount: 0,
        tags: ['shelf'],
      });
    }
    await setSetting('shelfSeeded', true);
  },
}));

// Handy for debugging in the console: `__cn.getState().score`, `__engine.outputLevel()`.
if (typeof window !== 'undefined') {
  (window as unknown as { __cn: typeof useApp }).__cn = useApp;
  (window as unknown as { __engine: typeof engine }).__engine = engine;
}

/** Track which bars have actually sounded, for the trouble map. */
engine.subscribe((q, playing) => {
  const state = useApp.getState();
  if (state.q !== q) useApp.setState({ q });
  if (playing && state.score) {
    for (const [num, m] of state.score.measureQ) {
      if (q >= m.start && q < m.start + m.length) {
        barsTouched.add(num);
        break;
      }
    }
  }
  if (!playing && state.transport.playing) {
    useApp.setState({ transport: engine.getState() });
  }
});

engine.onEnded(() => {
  const state = useApp.getState();
  useApp.setState({ transport: engine.getState() });
  if (state.ramp) state.rampPass();
});

/** Restore saved preferences and progress. */
void (async () => {
  const [theme, progress, unlocked, goal, simple] = await Promise.all([
    getSetting<'light' | 'dark' | 'system'>('theme', 'system'),
    getSetting<ProgressCounters>('progress', EMPTY_PROGRESS),
    getSetting<string[]>('unlocked', []),
    getSetting<number>('dailyGoalMin', DEFAULT_DAILY_GOAL_MIN),
    getSetting<boolean>('simpleMode', true),
  ]);
  useApp.getState().setTheme(theme);
  useApp.setState({
    simpleMode: simple,
    // Merge rather than replace: an older saved shape must not drop new counters.
    progress: { ...EMPTY_PROGRESS, ...progress },
    unlocked,
    dailyGoalMin: goal,
  });

  // Practising at an odd hour is worth noticing.
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5) useApp.getState().bump({ lateNight: true });
  else if (hour < 7) useApp.getState().bump({ earlyMorning: true });
})();
