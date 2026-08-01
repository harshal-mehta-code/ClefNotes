import type { StreakInfo } from '../db/db';

/**
 * Achievements, levels and the daily goal.
 *
 * Streaks and XP only mean something if they're attached to things a musician
 * actually values, so these reward *practice behaviour* rather than time
 * served: slowing a passage down, isolating your line, going back and fixing a
 * wrong note. Every one of them is a habit worth forming.
 */

/** Counters bumped as things happen. Persisted in settings under `progress`. */
export interface ProgressCounters {
  playCount: number;
  slowSeconds: number;
  loopPasses: number;
  minusOneUses: number;
  packsTried: string[];
  learningTracks: number;
  notesFixed: number;
  dailyDone: number;
  importsDone: number;
  rampsCompleted: number;
  bestMicAccuracy: number;
  micNotesScored: number;
  exports: number;
  earTrainingCorrect: number;
  earTrainingBest: number;
  lateNight: boolean;
  earlyMorning: boolean;
}

export const EMPTY_PROGRESS: ProgressCounters = {
  playCount: 0,
  slowSeconds: 0,
  loopPasses: 0,
  minusOneUses: 0,
  packsTried: [],
  learningTracks: 0,
  notesFixed: 0,
  dailyDone: 0,
  importsDone: 0,
  rampsCompleted: 0,
  bestMicAccuracy: 0,
  micNotesScored: 0,
  exports: 0,
  earTrainingCorrect: 0,
  earTrainingBest: 0,
  lateNight: false,
  earlyMorning: false,
};

export interface AchievementContext {
  progress: ProgressCounters;
  streak: StreakInfo | null;
  libraryCount: number;
  cleanBars: number;
}

export interface Achievement {
  id: string;
  name: string;
  /** What earns it — written so it reads as an invitation, not a rule. */
  hint: string;
  ink: 'blue' | 'pink' | 'mint' | 'gold' | 'violet';
  /** 0-1 towards unlocking. */
  progress: (c: AchievementContext) => number;
}

const ratio = (value: number, target: number) => Math.max(0, Math.min(1, value / target));

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-sound', name: 'First Sound', ink: 'blue',
    hint: 'Play a score from beginning to end.',
    progress: (c) => ratio(c.progress.playCount, 1),
  },
  {
    id: 'slow-is-smooth', name: 'Slow is Smooth', ink: 'mint',
    hint: 'Spend five minutes practising below 70% speed.',
    progress: (c) => ratio(c.progress.slowSeconds, 300),
  },
  {
    id: 'again-from-the-top', name: 'Again From the Top', ink: 'blue',
    hint: 'Complete 25 loop passes.',
    progress: (c) => ratio(c.progress.loopPasses, 25),
  },
  {
    id: 'section-leader', name: 'Section Leader', ink: 'pink',
    hint: 'Use minus-one mode to play along with the ensemble.',
    progress: (c) => ratio(c.progress.minusOneUses, 1),
  },
  {
    id: 'chorister', name: 'Chorister', ink: 'violet',
    hint: 'Make an SATB learning track in ClefVox.',
    progress: (c) => ratio(c.progress.learningTracks, 1),
  },
  {
    id: 'proofreader', name: 'Proofreader', ink: 'gold',
    hint: 'Correct ten notes with the editor.',
    progress: (c) => ratio(c.progress.notesFixed, 10),
  },
  {
    id: 'many-hats', name: 'Many Hats', ink: 'pink',
    hint: 'Hear one score through five different sound packs.',
    progress: (c) => ratio(c.progress.packsTried.length, 5),
  },
  {
    id: 'three-in-a-row', name: 'Three in a Row', ink: 'mint',
    hint: 'Practise three days running.',
    progress: (c) => ratio(c.streak?.current ?? 0, 3),
  },
  {
    id: 'fortnight', name: 'Fortnight', ink: 'gold',
    hint: 'Keep a fourteen-day streak.',
    progress: (c) => ratio(c.streak?.current ?? 0, 14),
  },
  {
    id: 'centurion', name: 'Centurion', ink: 'mint',
    hint: 'Get a hundred bars playing clean.',
    progress: (c) => ratio(c.cleanBars, 100),
  },
  {
    id: 'sight-reader', name: 'Sight Reader', ink: 'blue',
    hint: 'Open seven daily sight-reading phrases.',
    progress: (c) => ratio(c.progress.dailyDone, 7),
  },
  {
    id: 'good-ears', name: 'Good Ears', ink: 'violet',
    hint: 'Get a run of ten right in ear training.',
    progress: (c) => ratio(c.progress.earTrainingBest, 10),
  },
  {
    id: 'in-tune', name: 'In Tune', ink: 'mint',
    hint: 'Reach 90% pitch accuracy on the microphone.',
    progress: (c) => ratio(c.progress.bestMicAccuracy, 0.9),
  },
  {
    id: 'climber', name: 'Climber', ink: 'pink',
    hint: 'Finish a tempo ramp all the way to target.',
    progress: (c) => ratio(c.progress.rampsCompleted, 1),
  },
  {
    id: 'curator', name: 'Curator', ink: 'gold',
    hint: 'Collect ten scores in your library.',
    progress: (c) => ratio(c.libraryCount, 10),
  },
  {
    id: 'marathon', name: 'Marathon', ink: 'violet',
    hint: 'Practise for five hours in total.',
    progress: (c) => ratio((c.streak?.totalSeconds ?? 0) / 3600, 5),
  },
  {
    id: 'burning-the-oil', name: 'Burning the Oil', ink: 'blue',
    hint: 'Practise after midnight.',
    progress: (c) => (c.progress.lateNight ? 1 : 0),
  },
  {
    id: 'dawn-chorus', name: 'Dawn Chorus', ink: 'gold',
    hint: 'Practise before seven in the morning.',
    progress: (c) => (c.progress.earlyMorning ? 1 : 0),
  },
];

export function evaluate(ctx: AchievementContext) {
  return ACHIEVEMENTS.map((a) => {
    const value = a.progress(ctx);
    return { achievement: a, progress: value, unlocked: value >= 1 };
  });
}

/**
 * Levels.
 *
 * The curve widens as you go, so early levels arrive quickly — the point is to
 * show that practice accumulates, not to gate anything.
 */
export const LEVEL_TITLES = [
  'Beginner', 'Novice', 'Student', 'Apprentice', 'Player', 'Ensemble Player',
  'Section Player', 'Principal', 'Soloist', 'Recitalist', 'Virtuoso', 'Maestro',
];

export function levelFor(xp: number): { level: number; title: string; into: number; needed: number } {
  const level = Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1);
  const floorXp = Math.pow(level - 1, 2) * 60;
  const ceilXp = Math.pow(level, 2) * 60;
  return {
    level,
    title: LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, level - 1)],
    into: Math.max(0, xp - floorXp),
    needed: Math.max(1, ceilXp - floorXp),
  };
}

export const DEFAULT_DAILY_GOAL_MIN = 15;
