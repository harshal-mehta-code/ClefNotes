import { useEffect, useState } from 'react';
import { useApp } from './state/store';
import { instrumentsByFamily } from './lib/audio/instruments';
import Library from './components/Library';
import Sheet from './components/Sheet';
import Keys from './components/Keys';
import Contour from './components/Contour';

const KEYS = [
  { sharps: 0, label: 'C / A minor' },
  { sharps: 1, label: 'G / E minor' },
  { sharps: 2, label: 'D / B minor' },
  { sharps: 3, label: 'A / F♯ minor' },
  { sharps: 4, label: 'E / C♯ minor' },
  { sharps: 5, label: 'B / G♯ minor' },
  { sharps: -1, label: 'F / D minor' },
  { sharps: -2, label: 'B♭ / G minor' },
  { sharps: -3, label: 'E♭ / C minor' },
  { sharps: -4, label: 'A♭ / F minor' },
  { sharps: -5, label: 'D♭ / B♭ minor' },
];

export default function App() {
  const view = useApp((s) => s.view);
  const score = useApp((s) => s.score);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const closeScore = useApp((s) => s.closeScore);
  const instrument = useApp((s) => s.instrument);
  const setInstrument = useApp((s) => s.setInstrument);
  const zoom = useApp((s) => s.zoom);
  const setZoom = useApp((s) => s.setZoom);
  const showNotes = useApp((s) => s.showNotes);
  const setShowNotes = useApp((s) => s.setShowNotes);
  const setSharps = useApp((s) => s.setSharps);
  const importFile = useApp((s) => s.importFile);
  const [showRoll, setShowRoll] = useState(true);

  // A PDF dropped anywhere on the window imports.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      void importFile(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [importFile]);

  const families = instrumentsByFamily();

  return (
    <div className="grain flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-ink bg-paper px-3 py-1.5">
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
                className="field max-w-[132px]"
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

            <div className="hidden items-center gap-1.5 md:flex">
              <span className="lbl">Key</span>
              <select
                className="field"
                value={score.sharps}
                onChange={(e) => setSharps(Number(e.target.value))}
                aria-label="Key signature"
                title="Recognition can't read a key signature — set it and every note follows"
              >
                {KEYS.map((k) => (
                  <option key={k.sharps} value={k.sharps}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              className={`chip ${showNotes ? 'chip-on' : ''}`}
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
            <button className="chip" onClick={() => setZoom(Math.max(0.6, zoom - 0.15))} title="Smaller">
              −
            </button>
            <button className="chip" onClick={() => setZoom(Math.min(2.4, zoom + 0.15))} title="Larger">
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
          onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
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
