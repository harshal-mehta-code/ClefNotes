import { useState } from 'react';
import { useApp } from '../../state/store';
import ScoreView from './ScoreView';
import PianoRoll from './PianoRoll';
import Transport from './Transport';
import Mixer from './Mixer';
import Karaoke from './Karaoke';
import ExportMenu from './ExportMenu';
import { Chip } from '../ui/primitives';

export default function Studio() {
  const score = useApp((s) => s.score);
  const mode = useApp((s) => s.scoreMode);
  const setMode = useApp((s) => s.setScoreMode);
  const setView = useApp((s) => s.setView);
  const loading = useApp((s) => s.loading);
  const loadingLabel = useApp((s) => s.loadingLabel);
  const engraveOpts = useApp((s) => s.engraveOpts);
  const reEngrave = useApp((s) => s.reEngrave);
  const loopBars = useApp((s) => s.loopBars);
  const setLoopBars = useApp((s) => s.setLoopBars);
  const [showMixer, setShowMixer] = useState(true);

  if (!score) {
    return (
      <div className="mx-auto max-w-[900px] px-5 py-20 text-center">
        <h1 className="font-display text-[32px] font-extrabold tracking-tight">Nothing open</h1>
        <p className="mt-2 text-ink2">Pick something from the library to get started.</p>
        <button className="btn btn-primary mt-4" onClick={() => setView('library')}>
          Go to the library
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b-[1.5px] border-ink bg-panel px-3 py-2">
        <div className="min-w-0">
          <h1 className="truncate font-display text-[15px] font-bold leading-tight tracking-tight">
            {score.title}
          </h1>
          <div className="lbl truncate">
            {score.composer} · {score.parts.length} parts · {score.measureCount} bars
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Chip on={mode === 'sheet'} onClick={() => setMode('sheet')}>
            Sheet
          </Chip>
          <Chip on={mode === 'roll'} onClick={() => setMode('roll')}>
            Piano roll
          </Chip>
          <Chip on={mode === 'split'} onClick={() => setMode('split')}>
            Split
          </Chip>
          <span className="mx-1 h-5 w-px bg-rule2" />
          <Chip
            onClick={() => reEngrave({ scale: Math.max(24, engraveOpts.scale - 5) })}
            title="Smaller engraving"
          >
            −
          </Chip>
          <Chip
            onClick={() => reEngrave({ scale: Math.min(80, engraveOpts.scale + 5) })}
            title="Larger engraving"
          >
            +
          </Chip>
          {loopBars && (
            <Chip on onClick={() => setLoopBars(null)} title="Clear the loop">
              Loop {loopBars[0]}–{loopBars[1]} ✕
            </Chip>
          )}
          <Chip on={showMixer} onClick={() => setShowMixer((v) => !v)}>
            Mixer
          </Chip>
          <ExportMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          {loading && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-paper/85">
              <div className="text-center">
                <div className="font-display text-[17px] font-bold tracking-tight">{loadingLabel}</div>
                <div className="lbl mt-1">one moment</div>
              </div>
            </div>
          )}

          {mode === 'sheet' && (
            <div className="min-h-0 flex-1">
              <ScoreView />
            </div>
          )}
          {mode === 'roll' && (
            <div className="min-h-0 flex-1 bg-sunk">
              <PianoRoll />
            </div>
          )}
          {mode === 'split' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-[3]">
                <ScoreView />
              </div>
              <div className="min-h-0 flex-[2] border-t-[1.5px] border-ink bg-sunk">
                <PianoRoll />
              </div>
            </div>
          )}

          <Karaoke />
          <Transport />
        </div>

        {showMixer && (
          <aside className="hidden w-[286px] shrink-0 border-l-[1.5px] border-ink bg-panel md:block">
            <Mixer />
          </aside>
        )}
      </div>
    </div>
  );
}
