import { useEffect, useRef, useState } from 'react';
import { centsOff, hzToMidi, PitchTracker } from '../../lib/audio/pitch';
import { midiName, midiToFreq } from '../../lib/score/types';
import { engine } from '../../lib/audio/engine';
import { Chip, Label } from '../ui/primitives';

/**
 * A tuner.
 *
 * Everyone tunes before they practise, and everyone currently leaves the app to
 * do it. Since the pitch tracker is already here for scoring, a tuner costs
 * almost nothing and removes the one reason to reach for another tab.
 */

const A4_OPTIONS = [415, 432, 438, 440, 442, 444];

export default function Tuner() {
  const [on, setOn] = useState(false);
  const [a4, setA4] = useState(440);
  const [reading, setReading] = useState({ hz: 0, cents: 0, midi: 0, clarity: 0 });
  const [error, setError] = useState<string | null>(null);
  const trackerRef = useRef<PitchTracker | null>(null);

  useEffect(() => {
    if (!on) {
      trackerRef.current?.stop();
      trackerRef.current = null;
      setReading({ hz: 0, cents: 0, midi: 0, clarity: 0 });
      return;
    }
    const tracker = new PitchTracker();
    trackerRef.current = tracker;
    let raf = 0;
    let cancelled = false;

    tracker
      .start()
      .then(() => {
        if (cancelled) return;
        const loop = () => {
          raf = requestAnimationFrame(loop);
          const r = tracker.read();
          if (!r.hz) {
            setReading((p) => ({ ...p, hz: 0, clarity: r.clarity }));
            return;
          }
          // Re-reference the reading if the user isn't at A=440.
          const adjusted = r.hz * (440 / a4);
          setReading({
            hz: r.hz,
            cents: centsOff(adjusted),
            midi: Math.round(hzToMidi(adjusted)),
            clarity: r.clarity,
          });
        };
        raf = requestAnimationFrame(loop);
      })
      .catch(() => {
        setError('Microphone access was declined.');
        setOn(false);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      tracker.stop();
    };
  }, [on, a4]);

  const inTune = reading.hz > 0 && Math.abs(reading.cents) < 5;
  const close = reading.hz > 0 && Math.abs(reading.cents) < 15;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={`btn ${on ? 'btn-on' : ''}`} onClick={() => setOn((v) => !v)}>
          {on ? 'Listening' : 'Start the tuner'}
        </button>
        <div className="flex items-center gap-1.5">
          <span className="lbl">A =</span>
          <select
            className="field"
            value={a4}
            onChange={(e) => setA4(Number(e.target.value))}
            aria-label="Reference pitch for A4"
          >
            {A4_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v} Hz
              </option>
            ))}
          </select>
        </div>
        <Chip onClick={() => void engine.preview(69, 0, 2)} title="Sound a reference A">
          ♪ Play A
        </Chip>
      </div>

      {error && <p className="mt-2 text-[13px] text-crit">{error}</p>}

      {on && (
        <div className="mt-3">
          <div className="text-center">
            <div
              className="font-display text-[46px] font-extrabold leading-none tracking-[-0.04em]"
              style={{
                color: reading.hz
                  ? inTune
                    ? 'rgb(var(--ok))'
                    : close
                      ? 'rgb(var(--warn))'
                      : 'rgb(var(--ink))'
                  : 'rgb(var(--ink-3))',
              }}
            >
              {reading.hz ? midiName(reading.midi) : '—'}
            </div>
            <div className="lbl mt-1">
              {reading.hz
                ? `${reading.hz.toFixed(1)} Hz · target ${(midiToFreq(reading.midi) * (a4 / 440)).toFixed(1)} Hz`
                : 'play a note'}
            </div>
          </div>

          {/* A centre line with the needle either side — the shape every
              musician already knows how to read at a glance. */}
          <div className="relative mt-3 h-9 border border-rule2 bg-sunk">
            {[-50, -25, 0, 25, 50].map((tick) => (
              <div
                key={tick}
                className="absolute top-0 h-full"
                style={{
                  left: `${50 + tick}%`,
                  width: tick === 0 ? 2 : 1,
                  background: tick === 0 ? 'rgb(var(--ink-2))' : 'rgb(var(--rule-2))',
                }}
              />
            ))}
            <div
              className="absolute inset-y-0"
              style={{
                left: `${50 + Math.max(-50, Math.min(50, reading.cents))}%`,
                width: 4,
                marginLeft: -2,
                background: reading.hz
                  ? inTune
                    ? 'rgb(var(--ok))'
                    : close
                      ? 'rgb(var(--warn))'
                      : 'rgb(var(--crit))'
                  : 'transparent',
                transition: 'left 60ms linear',
              }}
            />
          </div>
          <div className="mt-1 flex justify-between">
            <span className="lbl">flat</span>
            <span className="num text-[12px]">
              {reading.hz ? `${reading.cents > 0 ? '+' : ''}${reading.cents.toFixed(0)}¢` : '—'}
            </span>
            <span className="lbl">sharp</span>
          </div>
          <Label className="mt-2">Within 5 cents reads green</Label>
        </div>
      )}
    </div>
  );
}
