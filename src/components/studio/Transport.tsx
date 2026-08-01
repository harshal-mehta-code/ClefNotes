import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../lib/audio/engine';
import { Num } from '../ui/primitives';

const RATES = [0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6, 2];

export default function Transport() {
  const score = useApp((s) => s.score);
  const transport = useApp((s) => s.transport);
  const patch = useApp((s) => s.patchTransport);
  const play = useApp((s) => s.play);
  const pause = useApp((s) => s.pause);
  const stop = useApp((s) => s.stop);
  const stepMode = useApp((s) => s.stepMode);
  const setStepMode = useApp((s) => s.setStepMode);
  const stepBy = useApp((s) => s.stepBy);
  const loopBars = useApp((s) => s.loopBars);
  const setLoopBars = useApp((s) => s.setLoopBars);
  const seekQ = useApp((s) => s.seekQ);

  const [pos, setPos] = useState({ bar: 1, beat: 1 });

  // The readout is a view of the audio clock, like everything else.
  useEffect(() => {
    if (!score) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const q = engine.getState().q;
      let bar = 1;
      let within = q;
      for (const [num, m] of score.measureQ) {
        if (q >= m.start && q < m.start + m.length) {
          bar = num;
          within = q - m.start;
          break;
        }
        if (q >= m.start) {
          bar = num;
          within = q - m.start;
        }
      }
      const beat = Math.floor(within / (4 / (score.beatUnit || 4))) + 1;
      setPos((p) => (p.bar === bar && p.beat === beat ? p : { bar, beat }));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  // Keyboard: the transport should never require the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (stepMode) void stepBy(1);
        else if (transport.playing) pause();
        else void play();
      } else if (e.key === 'ArrowRight' && stepMode) {
        e.preventDefault();
        void stepBy(1);
      } else if (e.key === 'ArrowLeft' && stepMode) {
        e.preventDefault();
        void stepBy(-1);
      } else if (e.key === 'Escape') {
        stop();
      } else if (e.key.toLowerCase() === 'l') {
        patch({ loop: !transport.loop });
      } else if (e.key.toLowerCase() === 'm') {
        patch({ metronome: !transport.metronome });
      } else if (e.key === '[') {
        patch({ bpm: Math.max(20, transport.bpm - 4) });
      } else if (e.key === ']') {
        patch({ bpm: Math.min(240, transport.bpm + 4) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [transport, stepMode, play, pause, stop, patch, stepBy]);

  if (!score) return null;
  const effective = Math.round(transport.bpm * transport.rate);

  return (
    <div className="flex flex-wrap items-center gap-2 border-t-[1.5px] border-ink bg-panel2 px-3 py-2.5">
      <button
        className="btn btn-primary min-w-[86px]"
        onClick={() => (transport.playing ? pause() : void play())}
        disabled={stepMode}
        title={stepMode ? 'Step mode is on — use the arrows' : 'Play / pause (space)'}
      >
        {transport.playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button className="btn" onClick={stop} title="Stop (esc)">
        ■
      </button>

      <div className="mx-1 h-6 w-px bg-rule2" />

      <button
        className={`btn ${stepMode ? 'btn-on' : ''}`}
        onClick={() => setStepMode(!stepMode)}
        aria-pressed={stepMode}
        title="Walk through the score one note at a time"
      >
        Step
      </button>
      {stepMode && (
        <>
          <button className="btn" onClick={() => void stepBy(-1)} title="Previous note (←)">
            ‹
          </button>
          <button className="btn" onClick={() => void stepBy(1)} title="Next note (→)">
            ›
          </button>
        </>
      )}

      <div className="mx-1 h-6 w-px bg-rule2" />

      <button
        className={`btn ${transport.loop ? 'btn-on' : ''}`}
        onClick={() => {
          if (transport.loop) setLoopBars(null);
          else patch({ loop: true });
        }}
        aria-pressed={transport.loop}
        title="Loop (l) — or drag across bars in the score"
      >
        ↻ {loopBars ? `${loopBars[0]}–${loopBars[1]}` : 'Loop'}
      </button>
      <button
        className={`btn ${transport.metronome ? 'btn-on' : ''}`}
        onClick={() => patch({ metronome: !transport.metronome })}
        aria-pressed={transport.metronome}
        title="Metronome (m)"
      >
        Click
      </button>
      <button
        className={`btn ${transport.countIn ? 'btn-on' : ''}`}
        onClick={() => patch({ countIn: !transport.countIn })}
        aria-pressed={transport.countIn}
        title="One bar of clicks before playback"
      >
        Count-in
      </button>

      <div className="mx-1 h-6 w-px bg-rule2" />

      <div className="flex items-center gap-2">
        <span className="lbl">Tempo</span>
        <input
          type="range"
          className="rng w-28"
          min={28}
          max={220}
          value={transport.bpm}
          onChange={(e) => patch({ bpm: Number(e.target.value) })}
          aria-label="Tempo in beats per minute"
        />
        <Num className="w-[68px] text-[12px]">
          {effective} <span className="lbl">BPM</span>
        </Num>
      </div>

      <div className="flex items-center gap-1">
        <span className="lbl">Speed</span>
        <select
          className="field"
          value={transport.rate}
          onChange={(e) => patch({ rate: Number(e.target.value) })}
          aria-label="Playback speed multiplier"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {Math.round(r * 100)}%
            </option>
          ))}
        </select>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <input
          type="range"
          className="rng w-32"
          min={0}
          max={Math.max(1, score.totalQ)}
          step={0.05}
          value={Math.min(transport.q, score.totalQ)}
          onChange={(e) => seekQ(Number(e.target.value))}
          aria-label="Position in the score"
        />
        <Num className="whitespace-nowrap text-[12px]">
          <span className="lbl">BAR</span> {pos.bar} <span className="lbl">BEAT</span> {pos.beat}
        </Num>
      </div>
    </div>
  );
}
