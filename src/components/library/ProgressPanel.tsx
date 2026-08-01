import { useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { heatOf } from '../../lib/db/db';
import { evaluate, levelFor } from '../../lib/progress/achievements';
import { Label } from '../ui/primitives';

/** A ring that fills as the day's practice goal is met. */
function GoalRing({ done, goal }: { done: number; goal: number }) {
  const pct = Math.max(0, Math.min(1, goal ? done / goal : 0));
  const r = 30;
  const c = 2 * Math.PI * r;
  const met = pct >= 1;
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="rgb(var(--sunk))" strokeWidth="8" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke={met ? 'rgb(var(--gold))' : 'rgb(var(--mint))'}
          strokeWidth="8"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="butt"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-none">
          <div className="num text-[16px] font-bold">{Math.round(done)}</div>
          <div className="lbl">/ {goal}m</div>
        </div>
      </div>
    </div>
  );
}

export default function ProgressPanel() {
  const streak = useApp((s) => s.streak);
  const progress = useApp((s) => s.progress);
  const library = useApp((s) => s.library);
  const bars = useApp((s) => s.bars);
  const goal = useApp((s) => s.dailyGoalMin);
  const setGoal = useApp((s) => s.setDailyGoal);
  const [showAll, setShowAll] = useState(false);

  const cleanBars = useMemo(
    () => Array.from(bars.values()).filter((b) => heatOf(b) === 'clean').length,
    [bars],
  );

  const results = useMemo(
    () => evaluate({ progress, streak, libraryCount: library.length, cleanBars }),
    [progress, streak, library.length, cleanBars],
  );

  const level = levelFor(streak?.xp ?? 0);
  const earned = results.filter((r) => r.unlocked).length;
  const todayMin = Math.round((streak?.todaySeconds ?? 0) / 60);

  return (
    <section className="mb-7 border-[1.5px] border-ink bg-panel">
      <div className="flex flex-wrap items-center gap-5 px-4 py-3.5">
        <GoalRing done={todayMin} goal={goal} />

        <div className="min-w-[150px]">
          <Label>Level {level.level}</Label>
          <div className="font-display text-[19px] font-extrabold leading-tight tracking-[-0.02em]">
            {level.title}
          </div>
          <div className="mt-1.5 h-[6px] w-full bg-sunk">
            <div
              className="h-full bg-riso-violet"
              style={{ width: `${(level.into / level.needed) * 100}%` }}
            />
          </div>
          <div className="lbl mt-1">
            {level.into} / {level.needed} XP
          </div>
        </div>

        <div className="flex gap-5">
          <div>
            <Label>Streak</Label>
            <div className="num text-[22px] font-bold leading-tight">
              {streak?.current ?? 0} <span className="lbl">days</span>
            </div>
          </div>
          <div>
            <Label>Badges</Label>
            <div className="num text-[22px] font-bold leading-tight">
              {earned} <span className="lbl">/ {results.length}</span>
            </div>
          </div>
          <div>
            <Label>Total</Label>
            <div className="num text-[22px] font-bold leading-tight">
              {Math.round((streak?.totalSeconds ?? 0) / 60)} <span className="lbl">min</span>
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="lbl">Daily goal</span>
          <select
            className="field"
            value={goal}
            onChange={(e) => setGoal(Number(e.target.value))}
            aria-label="Daily practice goal in minutes"
          >
            {[5, 10, 15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </div>
      </div>

      {streak && (
        <div className="flex gap-[3px] border-t border-rule px-4 py-2.5">
          {streak.days.map((d) => (
            <span
              key={d.date}
              title={`${d.date} · ${Math.round(d.seconds / 60)} min`}
              className="h-4 flex-1"
              style={{
                background:
                  d.seconds >= goal * 60
                    ? 'rgb(var(--gold))'
                    : d.seconds >= 60
                      ? 'rgb(var(--mint))'
                      : 'rgb(var(--sunk))',
              }}
            />
          ))}
        </div>
      )}

      {/* Eighteen badges is a wall on a first visit, so by default only the
          earned ones and the next few within reach are shown. */}
      <div className="border-t border-rule px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Label>Achievements</Label>
          <button className="lbl underline decoration-riso-pink" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'show fewer' : `show all ${results.length}`}
          </button>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-2">
          {results
            .slice()
            .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.progress - a.progress)
            .slice(0, showAll ? results.length : Math.max(4, earned + 3))
            .map(({ achievement, progress: value, unlocked }) => (
              <div
                key={achievement.id}
                title={achievement.hint}
                className="border border-rule2 p-2"
                style={{
                  borderColor: unlocked ? `rgb(var(--${achievement.ink}))` : undefined,
                  background: unlocked ? 'rgb(var(--panel-2))' : 'transparent',
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: unlocked ? `rgb(var(--${achievement.ink}))` : 'rgb(var(--sunk))',
                    }}
                  />
                  <span
                    className="truncate font-display text-[12px] font-bold tracking-tight"
                    style={{ opacity: unlocked ? 1 : 0.55 }}
                  >
                    {achievement.name}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-snug text-ink3">{achievement.hint}</p>
                {!unlocked && value > 0 && (
                  <div className="mt-1.5 h-[3px] bg-sunk">
                    <div
                      className="h-full"
                      style={{ width: `${value * 100}%`, background: `rgb(var(--${achievement.ink}))` }}
                    />
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
