import { useState } from 'react';
import { useApp } from '../../state/store';
import ScoreView from './ScoreView';
import PianoRoll from './PianoRoll';
import Transport from './Transport';
import Mixer from './Mixer';
import Karaoke from './Karaoke';
import ExportMenu from './ExportMenu';
import Keyboard from './Keyboard';
import NoteEditor from './NoteEditor';
import ShareButton from './ShareButton';
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
  const editing = useApp((s) => s.editing);
  const setEditing = useApp((s) => s.setEditing);
  const simpleMode = useApp((s) => s.simpleMode);
  const setSimpleMode = useApp((s) => s.setSimpleMode);
  // The mixer is a permanent column on a desktop and an on-demand sheet on a
  // phone, so it starts closed only where it would cover the music.
  const [showMixer, setShowMixer] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 768,
  );
  const [showKeys, setShowKeys] = useState(true);

  /**
   * Performance mode: everything but the music gets out of the way, the
   * engraving grows, and the screen is asked to stay awake. This is the mode
   * for a phone or tablet propped on a music stand.
   */
  const togglePerformance = async () => {
    const el = document.documentElement;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      setShowMixer(window.innerWidth >= 768);
      setShowKeys(true);
      await reEngrave({ scale: 42 });
    } else {
      await el.requestFullscreen?.().catch(() => {});
      setShowMixer(false);
      setShowKeys(false);
      await reEngrave({ scale: 56 });
      // Best effort: not every browser exposes this, and it is not essential.
      try {
        await (
          navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }
        ).wakeLock?.request('screen');
      } catch {
        /* screen may dim; the score still plays */
      }
    }
  };

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

        {/* Simple mode carries the four things a first-timer needs. Everything
            else is one tap away rather than in their face on arrival. */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {simpleMode ? (
            <>
              {loopBars && (
                <Chip on onClick={() => setLoopBars(null)} title="Clear the loop">
                  Loop {loopBars[0]}–{loopBars[1]} ✕
                </Chip>
              )}
              <Chip on={showMixer} onClick={() => setShowMixer((v) => !v)} title="Volume and instrument per part">
                Parts
              </Chip>
              <Chip onClick={() => setSimpleMode(false)} title="Show every control">
                More ⋯
              </Chip>
            </>
          ) : (
            <>
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
              <Chip on={showKeys} onClick={() => setShowKeys((v) => !v)} title="Piano keyboard">
                Keys
              </Chip>
              <Chip
                onClick={() => void togglePerformance()}
                title="Fill the screen with the music — for a music stand"
              >
                Perform
              </Chip>
              <Chip
                on={editing}
                onClick={() => setEditing(!editing)}
                title="Correct wrong notes — essential after a PDF import"
              >
                Fix notes
              </Chip>
              <Chip on={showMixer} onClick={() => setShowMixer((v) => !v)}>
                Mixer
              </Chip>
              <ShareButton />
              <ExportMenu />
              <Chip onClick={() => setSimpleMode(true)} title="Hide the advanced controls">
                Simple
              </Chip>
            </>
          )}
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

          {showKeys && (
            <div className="shrink-0 border-t-[1.5px] border-ink">
              <Keyboard height={84} />
            </div>
          )}
          <NoteEditor />
          <Karaoke />
          <Transport />
        </div>

        {/* Desktop: a fixed column. */}
        {showMixer && (
          <aside className="hidden w-[286px] shrink-0 border-l-[1.5px] border-ink bg-panel md:block">
            <Mixer />
          </aside>
        )}
      </div>

      {/* Phone: the same mixer as a sheet, because per-part control is the
          whole point of the app and hiding it on mobile would gut it. */}
      {showMixer && (
        <div className="md:hidden">
          <div
            className="fixed inset-0 z-[380] bg-[rgb(var(--sunk))]/70"
            onClick={() => setShowMixer(false)}
            aria-hidden
          />
          <aside
            className="fixed inset-x-0 bottom-0 z-[390] max-h-[72vh] overflow-y-auto border-t-[1.5px] border-ink bg-panel"
            role="dialog"
            aria-label="Part mixer"
          >
            <div className="sticky top-0 flex items-center gap-2 border-b border-rule bg-panel px-3 py-2">
              <span className="lbl">Parts &amp; sound</span>
              <button className="btn btn-ghost ml-auto" onClick={() => setShowMixer(false)}>
                Close
              </button>
            </div>
            <Mixer />
          </aside>
        </div>
      )}
    </div>
  );
}
