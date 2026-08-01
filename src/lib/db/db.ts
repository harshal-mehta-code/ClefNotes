import Dexie, { type Table } from 'dexie';
import type { PartMix } from '../audio/engine';

/**
 * Everything stays on the device.
 *
 * No account, no upload, no privacy policy, and it works on a plane. The whole
 * library exports to a single JSON file, which is the sync story: you own it.
 */

export interface StoredScore {
  id: string;
  title: string;
  composer: string;
  musicXml: string;
  source: string;
  /** Which shelf entry this came from, if any — lets us avoid duplicating them. */
  slug?: string;
  addedAt: number;
  openedAt: number;
  partCount: number;
  measureCount: number;
  tags: string[];
  /** Saved mixer state, so a score reopens the way you left it. */
  mixes?: PartMix[];
  bpm?: number;
}

/** Per-bar practice record — the raw material of the trouble map. */
export interface BarStat {
  /** `${scoreId}:${measure}` */
  key: string;
  scoreId: string;
  measure: number;
  /** Times this bar has been played through. */
  plays: number;
  /** Times it was looped specifically — a strong signal of trouble. */
  loops: number;
  /** Rolling mic accuracy 0-1, or -1 when never scored. */
  accuracy: number;
  /** Fastest tempo played cleanly. */
  bestBpm: number;
  updatedAt: number;
}

export interface Session {
  id?: number;
  scoreId: string;
  startedAt: number;
  /** Seconds of actual playback. */
  seconds: number;
  bars: number;
  xp: number;
}

export interface Settings {
  key: string;
  value: unknown;
}

class ClefNotesDb extends Dexie {
  scores!: Table<StoredScore, string>;
  bars!: Table<BarStat, string>;
  sessions!: Table<Session, number>;
  settings!: Table<Settings, string>;

  constructor() {
    super('clefnotes');
    this.version(1).stores({
      scores: 'id, title, addedAt, openedAt, slug',
      bars: 'key, scoreId, measure',
      sessions: '++id, scoreId, startedAt',
      settings: 'key',
    });
  }
}

export const db = new ClefNotesDb();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await db.settings.get(key);
    return row ? (row.value as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  try {
    await db.settings.put({ key, value });
  } catch {
    /* storage may be unavailable in private mode; the app still works */
  }
}

export async function recordBars(
  scoreId: string,
  measures: number[],
  opts: { looped?: boolean; accuracy?: number; bpm?: number } = {},
): Promise<void> {
  if (!measures.length) return;
  const now = Date.now();
  await db.transaction('rw', db.bars, async () => {
    for (const measure of measures) {
      const key = `${scoreId}:${measure}`;
      const existing = await db.bars.get(key);
      const prevAcc = existing?.accuracy ?? -1;
      const nextAcc =
        opts.accuracy == null
          ? prevAcc
          : prevAcc < 0
            ? opts.accuracy
            : prevAcc * 0.7 + opts.accuracy * 0.3;
      await db.bars.put({
        key,
        scoreId,
        measure,
        plays: (existing?.plays ?? 0) + 1,
        loops: (existing?.loops ?? 0) + (opts.looped ? 1 : 0),
        accuracy: nextAcc,
        bestBpm: Math.max(existing?.bestBpm ?? 0, opts.bpm ?? 0),
        updatedAt: now,
      });
    }
  });
}

export type Heat = 'untouched' | 'clean' | 'shaky' | 'trouble';

/**
 * Turn raw counts into the four colours on the trouble map.
 *
 * Repetition is the signal: a bar you keep going back to is a bar you can't
 * play yet, whether or not the microphone is on.
 */
export function heatOf(stat: BarStat | undefined): Heat {
  if (!stat || stat.plays === 0) return 'untouched';
  if (stat.accuracy >= 0) {
    if (stat.accuracy >= 0.9) return 'clean';
    if (stat.accuracy >= 0.72) return 'shaky';
    return 'trouble';
  }
  if (stat.loops >= 6) return 'trouble';
  if (stat.loops >= 3) return 'shaky';
  return 'clean';
}

export async function barsForScore(scoreId: string): Promise<Map<number, BarStat>> {
  const rows = await db.bars.where('scoreId').equals(scoreId).toArray();
  return new Map(rows.map((r) => [r.measure, r]));
}

export interface StreakInfo {
  current: number;
  longest: number;
  totalSeconds: number;
  todaySeconds: number;
  xp: number;
  days: Array<{ date: string; seconds: number }>;
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export async function streakInfo(): Promise<StreakInfo> {
  const sessions = await db.sessions.toArray();
  const byDay = new Map<string, number>();
  let totalSeconds = 0;
  let xp = 0;
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    byDay.set(k, (byDay.get(k) ?? 0) + s.seconds);
    totalSeconds += s.seconds;
    xp += s.xp;
  }

  // Walk back from today; a day counts once at least a minute is logged.
  const today = dayKey(Date.now());
  let current = 0;
  const cursor = new Date();
  for (let i = 0; i < 400; i++) {
    const k = dayKey(cursor.getTime());
    const secs = byDay.get(k) ?? 0;
    if (secs >= 60) current++;
    else if (k !== today) break;
    else if (i > 0) break;
    cursor.setDate(cursor.getDate() - 1);
  }

  let longest = 0;
  let run = 0;
  const sortedDays = Array.from(byDay.keys()).sort();
  let prev: string | null = null;
  for (const k of sortedDays) {
    if ((byDay.get(k) ?? 0) < 60) continue;
    if (prev) {
      const gap = (Date.parse(k) - Date.parse(prev)) / 86400000;
      run = gap === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = k;
  }

  const days: Array<{ date: string; seconds: number }> = [];
  const walk = new Date();
  walk.setDate(walk.getDate() - 27);
  for (let i = 0; i < 28; i++) {
    const k = dayKey(walk.getTime());
    days.push({ date: k, seconds: byDay.get(k) ?? 0 });
    walk.setDate(walk.getDate() + 1);
  }

  return {
    current,
    longest: Math.max(longest, current),
    totalSeconds,
    todaySeconds: byDay.get(today) ?? 0,
    xp,
    days,
  };
}

export async function logSession(scoreId: string, seconds: number, bars: number): Promise<void> {
  if (seconds < 3) return;
  // XP rewards time on task plus ground covered, so looping four bars for ten
  // minutes still counts for something.
  const xp = Math.round(seconds / 6 + bars * 2);
  await db.sessions.add({ scoreId, startedAt: Date.now(), seconds, bars, xp });
}

/** The whole library as one file. This is the sync story. */
export async function exportLibrary(): Promise<Blob> {
  const [scores, bars, sessions, settings] = await Promise.all([
    db.scores.toArray(),
    db.bars.toArray(),
    db.sessions.toArray(),
    db.settings.toArray(),
  ]);
  const payload = {
    format: 'clefnotes-library',
    version: 1,
    exportedAt: new Date().toISOString(),
    scores,
    bars,
    sessions,
    settings,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export async function importLibrary(file: File): Promise<{ scores: number }> {
  const text = await file.text();
  const data = JSON.parse(text) as {
    format?: string;
    scores?: StoredScore[];
    bars?: BarStat[];
    sessions?: Session[];
    settings?: Settings[];
  };
  if (data.format !== 'clefnotes-library') {
    throw new Error('That file is not a ClefNotes library export.');
  }
  await db.transaction('rw', db.scores, db.bars, db.sessions, db.settings, async () => {
    if (data.scores?.length) await db.scores.bulkPut(data.scores);
    if (data.bars?.length) await db.bars.bulkPut(data.bars);
    if (data.sessions?.length) {
      await db.sessions.bulkAdd(data.sessions.map(({ id: _id, ...rest }) => rest as Session));
    }
    if (data.settings?.length) await db.settings.bulkPut(data.settings);
  });
  return { scores: data.scores?.length ?? 0 };
}
