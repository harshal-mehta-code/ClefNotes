import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../lib/audio/engine';
import { centsOff, hzToMidi, PitchTracker } from '../../lib/audio/pitch';
import { heatOf, recordBars, type Heat } from '../../lib/db/db';
import { midiName } from '../../lib/score/types';
import { Chip, Meter, Panel, Stat } from '../ui/primitives';
import EarTrainer from './EarTrainer';
import Recorder from './Recorder';
import Tuner from './Tuner';

const HEAT_COLOUR: Record<Heat, string> = {
  untouched: 'rgb(var(--sunk))',
  clean: 'rgb(var(--mint))',
  shaky: 'rgb(var(--warn))',
  trouble: 'rgb(var(--crit))',
};

/**
 * Practice Lab.
 *
 * The Studio plays a score; this turns playing it into progress you can see.
 * Two mechanics do the work: bars redden as you keep going back to them, and
 * the tempo only goes up when a pass is clean.
 */
export default function PracticeLab() {
  const score = useApp((s) => s.score);
  const bars = useApp((s) => s.bars);
  const streak = useApp((s) => s.streak);
  const transport = useApp((s) => s.transport);
  const patch = useApp((s) => s.patchTransport);
  const setLoopBars = useApp((s) => s.setLoopBars);
  const loopBars = useApp((s) => s.loopBars);
  const ramp = useApp((s) => s.ramp);
  const startRamp = useApp((s) => s.startRamp);
  const clearRamp = useApp((s) => s.clearRamp);
  const refreshStats = useApp((s) => s.refreshStats);
  const setView = useApp((s) => s.setView);

  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [reading, setReading] = useState({ hz: 0, clarity: 0, level: 0, cents: 0 });
  const [scorecard, setScorecard] = useState({ hits: 0, tried: 0, streak: 0, best: 0 });
  const trackerRef = useRef<PitchTracker | null>(null);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats, score]);

  const troubleBars = useMemo(() => {
    const out: number[] = [];
    for (const [measure, stat] of bars) {
      const h = heatOf(stat);
      if (h === 'trouble' || h === 'shaky') out.push(measure);
    }
    return out.sort((a, b) => a - b);
  }, [bars]);

  // --- microphone scoring --------------------------------------------------
  useEffect(() => {
    if (!micOn) {
      trackerRef.current?.stop();
      trackerRef.current = null;
      return;
    }
    const tracker = new PitchTracker();
    trackerRef.current = tracker;
    let raf = 0;
    let cancelled = false;
    let hits = 0;
    let tried = 0;
    let run = 0;
    let best = 0;
    let lastCounted = -1;

    tracker
      .start()
      .then(() => {
        if (cancelled) return;
        const loop = () => {
          raf = requestAnimationFrame(loop);
          const r = tracker.read();
          setReading({ hz: r.hz, clarity: r.clarity, level: r.level, cents: r.hz ? centsOff(r.hz) : 0 });

          // Compare against whatever the score says should be sounding now.
          const state = engine.getState();
          if (!state.playing || !score || !r.hz) return;
          const q = state.q;
          const expected = score.notes.filter((n) => q >= n.q && q < n.q + n.qDur);
          if (!expected.length) return;
          const key = Math.round(q * 8);
          if (key === lastCounted) return;
          lastCounted = key;

          const heard = hzToMidi(r.hz);
          const match = expected.some((n) => {
            const diff = Math.abs(((heard - n.midi + 6) % 12) - 6);
            return diff < 0.6;
          });
          tried++;
          if (match) {
            hits++;
            run++;
            best = Math.max(best, run);
          } else {
            run = 0;
          }
          setScorecard({ hits, tried, streak: run, best });
        };
        raf = requestAnimationFrame(loop);
      })
      .catch((e: unknown) => {
        setMicError(
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'Microphone access was declined. Everything else in the Lab still works.'
            : 'No microphone was available.',
        );
        setMicOn(false);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      tracker.stop();
    };
  }, [micOn, score]);

  if (!score) {
    return (
      <div className="mx-auto max-w-[900px] px-5 py-16 text-center">
        <h1 className="font-display text-[30px] font-extrabold tracking-tight">Nothing open yet</h1>
        <p className="mt-2 text-ink2">Open a score and the Lab starts keeping track.</p>
        <button className="btn btn-primary mt-4" onClick={() => setView('library')}>
          Go to the library
        </button>
      </div>
    );
  }

  const accuracy = scorecard.tried ? scorecard.hits / scorecard.tried : 0;
  const measures = Array.from({ length: score.measureCount }, (_, i) => i + 1);
  const played = measures.filter((m) => heatOf(bars.get(m)) !== 'untouched').length;
  const clean = measures.filter((m) => heatOf(bars.get(m)) === 'clean').length;

  return (
    <div className="mx-auto grid w-full max-w-[1180px] gap-4 px-5 py-7 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <Panel title={`Trouble map · ${score.title}`}>
          {/* Fixed-size cells: a heat map should read as a dense grid whatever
              the bar count, not stretch to fill the panel. */}
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(0, 26px))' }}
          >
            {measures.map((m) => {
              const stat = bars.get(m);
              const h = heatOf(stat);
              const inLoop = loopBars && m >= loopBars[0] && m <= loopBars[1];
              return (
                <button
                  key={m}
                  title={`Bar ${m}${stat ? ` · ${stat.plays} plays · ${stat.loops} loops` : ' · not played yet'}`}
                  onClick={() => setLoopBars([m, m])}
                  className="aspect-square rounded-[1px] text-[0px]"
                  style={{
                    background: HEAT_COLOUR[h],
                    opacity: h === 'untouched' ? 0.5 : 1,
                    outline: inLoop ? '2px solid rgb(var(--blue))' : 'none',
                    outlineOffset: '-2px',
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-3">
            {(['untouched', 'clean', 'shaky', 'trouble'] as Heat[]).map((h) => (
              <span key={h} className="lbl flex items-center gap-1.5">
                <i className="block h-2.5 w-2.5" style={{ background: HEAT_COLOUR[h] }} />
                {h}
              </span>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Chip
              onClick={() => {
                if (!troubleBars.length) return;
                setLoopBars([troubleBars[0], troubleBars[troubleBars.length - 1]]);
                setView('studio');
              }}
              title="Loop the span containing your weakest bars"
            >
              Drill the {troubleBars.length} rough bar{troubleBars.length === 1 ? '' : 's'}
            </Chip>
            <Chip onClick={() => setLoopBars(null)}>Clear loop</Chip>
            <Chip
              onClick={() => {
                void recordBars(score.id, measures, { accuracy: -1 }).then(() => refreshStats());
              }}
              title="Forget the history for this score"
            >
              Reset map
            </Chip>
          </div>
        </Panel>

        <Panel title="Record yourself">
          <Recorder />
        </Panel>

        <Panel title="Ear training">
          <EarTrainer />
        </Panel>

        <Panel title="Tempo ramp">
          <p className="mb-3 max-w-[58ch] text-[14px] leading-snug text-ink2">
            Loop a passage and let the tempo climb. Each completed pass adds 5% — so the speed you
            end at is a speed you actually played.
          </p>

          {ramp ? (
            <>
              <div className="flex h-20 items-end gap-1">
                {Array.from({ length: 10 }, (_, i) => {
                  const bpm = Math.round(ramp.from * Math.pow(1 + ramp.step / 100, i));
                  const done = bpm < ramp.current;
                  const now = Math.abs(bpm - ramp.current) < 1;
                  return (
                    <div
                      key={i}
                      title={`${bpm} BPM`}
                      className="flex-1"
                      style={{
                        height: `${30 + i * 7}%`,
                        background: now ? 'rgb(var(--pink))' : 'rgb(var(--blue))',
                        opacity: done || now ? 1 : 0.32,
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="lbl">
                  {ramp.from} → {ramp.to} BPM · {ramp.passes} pass{ramp.passes === 1 ? '' : 'es'}
                </span>
                <span className="num text-[13px] font-bold">{ramp.current} BPM</span>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn" onClick={() => useApp.getState().rampPass()}>
                  Mark pass clean →
                </button>
                <button className="btn btn-ghost" onClick={clearRamp}>
                  Stop ramp
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-primary"
                onClick={() => startRamp(Math.max(30, Math.round(transport.bpm * 0.6)), Math.round(transport.bpm * 1.15), 5)}
                disabled={!loopBars}
                title={loopBars ? undefined : 'Select a loop range first'}
              >
                Start ramp {loopBars ? `on bars ${loopBars[0]}–${loopBars[1]}` : ''}
              </button>
              {!loopBars && <span className="lbl self-center">Pick a loop range in the Studio first</span>}
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Tuner">
          <Tuner />
        </Panel>

        <Panel title="Listening to you">
          {micError && <p className="mb-2 text-[13px] leading-snug text-crit">{micError}</p>}
          <button
            className={`btn w-full ${micOn ? 'btn-on' : ''}`}
            onClick={() => {
              setMicError(null);
              setMicOn((v) => !v);
            }}
          >
            {micOn ? 'Microphone on' : 'Turn on the microphone'}
          </button>

          {micOn && (
            <div className="mt-3">
              <Stat
                label="Hearing"
                value={reading.hz ? `${midiName(Math.round(hzToMidi(reading.hz)))} · ${reading.hz.toFixed(1)} Hz` : '—'}
              />
              <div className="my-2">
                <div className="lbl mb-1">Tuning</div>
                <div className="relative h-3 bg-sunk">
                  <div className="absolute left-1/2 top-0 h-full w-px bg-ink3" />
                  {reading.hz > 0 && (
                    <div
                      className="absolute top-0 h-full w-[3px]"
                      style={{
                        left: `${50 + Math.max(-50, Math.min(50, reading.cents / 1))}%`,
                        background:
                          Math.abs(reading.cents) < 12 ? 'rgb(var(--ok))' : 'rgb(var(--warn))',
                      }}
                    />
                  )}
                </div>
                <div className="lbl mt-1 text-right">
                  {reading.hz ? `${reading.cents > 0 ? '+' : ''}${reading.cents.toFixed(0)} cents` : '—'}
                </div>
              </div>
              <Stat label="Input" value={`${Math.round(reading.level * 400)}%`} />
              <Meter value={reading.level * 4} tone="rgb(var(--blue))" />

              <div className="mt-3 border-t border-rule pt-3">
                <Stat label="Pitch accuracy" value={`${Math.round(accuracy * 100)}%`} />
                <Meter
                  value={accuracy}
                  tone={accuracy > 0.85 ? 'rgb(var(--ok))' : accuracy > 0.6 ? 'rgb(var(--warn))' : 'rgb(var(--crit))'}
                />
                <div className="mt-2">
                  <Stat label="Current run" value={`${scorecard.streak} notes`} />
                  <Stat label="Best run" value={`${scorecard.best} notes`} />
                </div>
                <p className="lbl mt-2 leading-relaxed">
                  Play along while the score is running. Octaves count as correct.
                </p>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="This score">
          <Stat label="Bars" value={score.measureCount} />
          <Stat label="Played" value={`${played} / ${score.measureCount}`} />
          <Stat label="Clean" value={`${clean} / ${score.measureCount}`} />
          <div className="mt-1.5">
            <Meter value={score.measureCount ? clean / score.measureCount : 0} />
          </div>
          <div className="mt-3">
            <Stat label="Tempo" value={`${Math.round(transport.bpm * transport.rate)} BPM`} />
            <Stat label="Marked" value={`${score.bpm} BPM`} />
            <div className="mt-2 flex gap-1.5">
              <Chip onClick={() => patch({ bpm: score.bpm, rate: 1 })}>Back to marked tempo</Chip>
            </div>
          </div>
        </Panel>

        {streak && (
          <Panel title="You">
            <Stat label="Streak" value={`${streak.current} days`} />
            <Stat label="Longest" value={`${streak.longest} days`} />
            <Stat label="Total practice" value={`${Math.round(streak.totalSeconds / 60)} min`} />
            <Stat label="XP" value={streak.xp} tone="rgb(var(--gold))" />
            <div className="mt-2 grid grid-cols-14 gap-[3px]" style={{ gridTemplateColumns: 'repeat(14, minmax(0,1fr))' }}>
              {streak.days.slice(-14).map((d) => (
                <span
                  key={d.date}
                  title={`${d.date} · ${Math.round(d.seconds / 60)} min`}
                  className="aspect-square"
                  style={{
                    background:
                      d.seconds >= 600 ? 'rgb(var(--gold))' : d.seconds >= 60 ? 'rgb(var(--mint))' : 'rgb(var(--sunk))',
                  }}
                />
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
