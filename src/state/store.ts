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
  logSession,
  recordBars,
  setSetting,
  streakInfo,
  type BarStat,
  type StoredScore,
  type StreakInfo,
} from '../lib/db/db';
import { SHELF, shelfXml } from '../data/scores/shelf';

export type ViewId = 'library' | 'studio' | 'lab' | 'vox' | 'import';
export type ScoreViewMode = 'sheet' | 'roll' | 'split';

interface AppState {
  view: ViewId;
  scoreMode: ScoreViewMode;
  theme: 'light' | 'dark' | 'system';

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

  setView: (v: ViewId) => void;
  setScoreMode: (m: ScoreViewMode) => void;
  setTheme: (t: 'light' | 'dark' | 'system') => void;

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

  setView: (view) => set({ view }),
  setScoreMode: (scoreMode) => set({ scoreMode }),
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
  },

  pause: () => {
    engine.pause();
    if (playStartedAt) {
      accumulatedSeconds += (performance.now() - playStartedAt) / 1000;
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
  },

  clearRamp: () => set({ ramp: null }),

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

// Handy for debugging in the console: `__cn.getState().score`.
if (typeof window !== 'undefined') {
  (window as unknown as { __cn: typeof useApp }).__cn = useApp;
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

/** Restore the saved theme before first paint where possible. */
void (async () => {
  const theme = await getSetting<'light' | 'dark' | 'system'>('theme', 'system');
  useApp.getState().setTheme(theme);
})();
