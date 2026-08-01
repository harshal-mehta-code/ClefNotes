import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../lib/audio/engine';
import { midiName } from '../../lib/score/types';
import { Chip, Label, Meter, Stat } from '../ui/primitives';

/**
 * Ear training, built from the score you already have open.
 *
 * Generic interval drills get abandoned because they feel like homework
 * unrelated to anything. Drawing the questions from the piece in front of you
 * makes every right answer double as rehearsal — you are learning intervals
 * *and* the phrase you have to perform on Saturday.
 */

type Mode = 'interval' | 'which-bar' | 'higher-lower';

const INTERVALS = [
  'Unison', 'Minor 2nd', 'Major 2nd', 'Minor 3rd', 'Major 3rd', 'Perfect 4th',
  'Tritone', 'Perfect 5th', 'Minor 6th', 'Major 6th', 'Minor 7th', 'Major 7th', 'Octave',
];

interface Question {
  mode: Mode;
  /** Pitches to sound, in order. */
  notes: number[];
  options: string[];
  answer: number;
  /** Where in the score this came from, so it can be found afterwards. */
  measure?: number;
  q?: number;
}

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function EarTrainer() {
  const score = useApp((s) => s.score);
  const bump = useApp((s) => s.bump);
  const seekQ = useApp((s) => s.seekQ);
  const setView = useApp((s) => s.setView);

  const [mode, setMode] = useState<Mode>('interval');
  const [question, setQuestion] = useState<Question | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [run, setRun] = useState(0);
  const [best, setBest] = useState(0);
  const [right, setRight] = useState(0);
  const [asked, setAsked] = useState(0);

  const build = useCallback((): Question | null => {
    if (!score || score.notes.length < 4) return null;
    const notes = score.notes;

    if (mode === 'which-bar') {
      // Play a phrase; find where it came from.
      const start = Math.floor(Math.random() * Math.max(1, notes.length - 5));
      const phrase = notes.slice(start, start + 4);
      const correctMeasure = phrase[0].measure;
      const others = shuffle(
        Array.from({ length: score.measureCount }, (_, i) => i + 1).filter((m) => m !== correctMeasure),
      ).slice(0, 3);
      const options = shuffle([correctMeasure, ...others]);
      return {
        mode,
        notes: phrase.map((n) => n.midi),
        options: options.map((m) => `Bar ${m}`),
        answer: options.indexOf(correctMeasure),
        measure: correctMeasure,
        q: phrase[0].q,
      };
    }

    if (mode === 'higher-lower') {
      const i = Math.floor(Math.random() * (notes.length - 1));
      const a = notes[i];
      const b = notes.find((n, k) => k > i && n.midi !== a.midi) ?? notes[i + 1];
      const higher = b.midi > a.midi;
      return {
        mode,
        notes: [a.midi, b.midi],
        options: ['Higher', 'Lower'],
        answer: higher ? 0 : 1,
        measure: a.measure,
        q: a.q,
      };
    }

    // Intervals drawn from consecutive notes in one part.
    const part = Math.floor(Math.random() * score.parts.length);
    const inPart = notes.filter((n) => n.part === part);
    if (inPart.length < 2) return null;
    const i = Math.floor(Math.random() * (inPart.length - 1));
    const a = inPart[i];
    const b = inPart[i + 1];
    const semis = Math.min(12, Math.abs(b.midi - a.midi));
    const correct = INTERVALS[semis];
    const distractors = shuffle(INTERVALS.filter((n) => n !== correct)).slice(0, 3);
    const options = shuffle([correct, ...distractors]);
    return {
      mode,
      notes: [a.midi, b.midi],
      options,
      answer: options.indexOf(correct),
      measure: a.measure,
      q: a.q,
    };
  }, [score, mode]);

  const playQuestion = useCallback(async (qn: Question) => {
    for (let i = 0; i < qn.notes.length; i++) {
      window.setTimeout(() => void engine.preview(qn.notes[i], 0, 0.55), i * 520);
    }
  }, []);

  const next = useCallback(() => {
    const qn = build();
    setQuestion(qn);
    setPicked(null);
    if (qn) void playQuestion(qn);
  }, [build, playQuestion]);

  useEffect(() => {
    setQuestion(null);
    setPicked(null);
  }, [mode, score]);

  const answer = (i: number) => {
    if (!question || picked != null) return;
    setPicked(i);
    setAsked((n) => n + 1);
    const correct = i === question.answer;
    if (correct) {
      setRight((n) => n + 1);
      const newRun = run + 1;
      setRun(newRun);
      setBest((b) => Math.max(b, newRun));
      bump((p) => ({
        earTrainingCorrect: p.earTrainingCorrect + 1,
        earTrainingBest: Math.max(p.earTrainingBest, newRun),
      }));
    } else {
      setRun(0);
    }
  };

  if (!score) return null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip on={mode === 'interval'} onClick={() => setMode('interval')}>
          Name the interval
        </Chip>
        <Chip on={mode === 'which-bar'} onClick={() => setMode('which-bar')}>
          Find the bar
        </Chip>
        <Chip on={mode === 'higher-lower'} onClick={() => setMode('higher-lower')}>
          Higher or lower
        </Chip>
      </div>

      <p className="mb-3 max-w-[58ch] text-[14px] leading-snug text-ink2">
        Every question comes from <em>{score.title}</em> — so getting better at these is the same
        work as learning the piece.
      </p>

      {!question ? (
        <button className="btn btn-primary" onClick={next}>
          Start listening →
        </button>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="btn" onClick={() => void playQuestion(question)}>
              ♪ Play it again
            </button>
            {picked != null && (
              <button className="btn btn-primary" onClick={next}>
                Next →
              </button>
            )}
            {picked != null && question.q != null && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  seekQ(question.q!);
                  setView('studio');
                }}
              >
                Show me in the score →
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {question.options.map((opt, i) => {
              const isAnswer = i === question.answer;
              const chosen = picked === i;
              const revealed = picked != null;
              return (
                <button
                  key={opt}
                  onClick={() => answer(i)}
                  disabled={revealed}
                  className="border-[1.5px] px-2 py-3 text-center font-display text-[13.5px] font-bold tracking-tight"
                  style={{
                    borderColor: revealed && isAnswer ? 'rgb(var(--ok))' : chosen ? 'rgb(var(--crit))' : 'rgb(var(--rule-2))',
                    background: revealed && isAnswer ? 'rgb(var(--ok) / 0.16)' : chosen ? 'rgb(var(--crit) / 0.14)' : 'transparent',
                    opacity: revealed && !isAnswer && !chosen ? 0.5 : 1,
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          {picked != null && (
            <p className="mt-2.5 text-[13.5px] text-ink2">
              {picked === question.answer ? 'Right.' : `Not quite — it was ${question.options[question.answer]}.`}{' '}
              <span className="lbl">
                {question.notes.map((m) => midiName(m)).join(' → ')}
                {question.measure ? ` · bar ${question.measure}` : ''}
              </span>
            </p>
          )}
        </>
      )}

      <div className="mt-4 border-t border-rule pt-3">
        <Stat label="Correct" value={`${right} / ${asked}`} />
        <Meter value={asked ? right / asked : 0} />
        <div className="mt-1.5">
          <Stat label="Current run" value={run} />
          <Stat label="Best run" value={best} tone={best >= 10 ? 'rgb(var(--gold))' : undefined} />
        </div>
        <Label className="mt-2">Ten in a row earns Good Ears</Label>
      </div>
    </div>
  );
}
