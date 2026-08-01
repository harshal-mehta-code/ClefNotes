import { useEffect, useMemo, useState } from 'react';
import { useApp } from './state/store';
import { instrumentsByFamily } from './lib/audio/instruments';
import { KEYS } from './lib/detect/types';
import Library from './components/Library';
import Sheet from './components/Sheet';
import Keys from './components/Keys';
import Contour from './components/Contour';

export default function App() {
  const view = useApp((s) => s.view);
  const score = useApp((s) => s.score);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const closeScore = useApp((s) => s.closeScore);
  const instrument = useApp((s) => s.instrument);
  const setInstrument = useApp((s) => s.setInstrument);
  const zoomBy = useApp((s) => s.zoomBy);
  const showNotes = useApp((s) => s.showNotes);
  const setShowNotes = useApp((s) => s.setShowNotes);
  const setSharps = useApp((s) => s.setSharps);
  const visiblePage = useApp((s) => s.visiblePage);
  const importFiles = useApp((s) => s.importFiles);
  const [showRoll, setShowRoll] = useState(true);

  // The key shown is the one in force where you are reading, since a score can
  // change key partway through and a single number would be a lie on one of the
  // two halves.
  const shownKey = useMemo(() => {
    if (!score) return 0;
    const here = score.staves.find((s) => s.page === visiblePage && s.sharps != null);
    return here?.sharps ?? score.sharps;
  }, [score, visiblePage]);

  // A PDF or a picture dropped anywhere on the window imports.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void importFiles(files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [importFiles]);

  const families = instrumentsByFamily();

  return (
    <div className="grain flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1.5 border-b-[1.5px] border-ink bg-paper px-2 py-1.5 sm:gap-2 sm:px-3">
        <button
          className="flex shrink-0 items-center font-display text-[14px] font-extrabold tracking-[-0.02em]"
          onClick={closeScore}
          title="ClefNotes"
        >
          <span
            className="inline-block h-[10px] w-[10px] rounded-full"
            style={{ background: 'rgb(var(--pink))', boxShadow: '5px 0 0 rgb(var(--blue))' }}
          />
          <span className="ml-[11px] hidden sm:inline">ClefNotes</span>
        </button>

        {view === 'sheet' && score && (
          <>
            <span className="lbl min-w-0 flex-1 truncate">{score.title}</span>

            <div className="flex items-center gap-1.5">
              <span className="lbl hidden sm:inline">Sound</span>
              <select
                className="field max-w-[92px] sm:max-w-[132px]"
                value={instrument}
                onChange={(e) => setInstrument(e.target.value as typeof instrument)}
                aria-label="Instrument"
              >
                {families.map(([family, list]) => (
                  <optgroup key={family} label={family}>
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="lbl hidden sm:inline">Key</span>
              <select
                className="field max-w-[92px] sm:max-w-none"
                value={shownKey}
                onChange={(e) => setSharps(Number(e.target.value), shownKey)}
                aria-label="Key signature"
                title="The key in force on the page you are reading, read from the page. Changing it retunes every staff in that key, leaving a later key change alone; a single staff can be set in the margin beside it."
              >
                {KEYS.map((k) => (
                  <option key={k.sharps} value={k.sharps}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Zoom earns its place on a phone, where a notehead is a couple of
                millimetres across and a fingertip is not. The dots and the roll
                are worth less than that room, so they wait for a wider screen. */}
            <button
              className={`chip hidden sm:inline-block ${showNotes ? 'chip-on' : ''}`}
              onClick={() => setShowNotes(!showNotes)}
              title="Show or hide the dots over each detected note"
            >
              Dots
            </button>
            <button
              className={`chip hidden sm:inline-block ${showRoll ? 'chip-on' : ''}`}
              onClick={() => setShowRoll((v) => !v)}
            >
              Roll
            </button>
            <button
              className="chip"
              onClick={() => zoomBy(-0.25)}
              title="Smaller"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              className="chip"
              onClick={() => zoomBy(0.25)}
              title="Larger"
              aria-label="Zoom in"
            >
              +
            </button>
            <button className="chip" onClick={closeScore}>
              Library
            </button>
          </>
        )}

        {/* With a score open there is no room for this on a phone; the library
            screen has plenty, and that is where you start anyway. */}
        <button
          className={`lbl shrink-0 rounded-sm px-2 py-1 hover:bg-ink hover:text-paper ${
            view === 'sheet' ? 'hidden sm:block' : 'ml-auto'
          }`}
          onClick={() =>
            setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')
          }
          title="Light, dark, or follow the system"
        >
          {theme === 'system' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        {view === 'library' || !score ? <Library /> : <Sheet />}
      </main>

      {view === 'sheet' && score && (
        <div className="shrink-0 border-t-[1.5px] border-ink">
          {showRoll && (
            <div className="hidden border-b border-rule sm:block">
              <Contour height={116} />
            </div>
          )}
          <Keys height={72} />
        </div>
      )}
    </div>
  );
}
