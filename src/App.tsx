import { useEffect } from 'react';
import { useApp, type ViewId } from './state/store';
import Library from './components/library/Library';
import ImportPanel from './components/library/ImportPanel';
import Studio from './components/studio/Studio';
import PracticeLab from './components/lab/PracticeLab';
import VoxPanel from './components/vox/VoxPanel';

const TABS: Array<{ id: ViewId; label: string; hint: string }> = [
  { id: 'library', label: 'Library', hint: 'Your scores' },
  { id: 'studio', label: 'Studio', hint: 'Play and mix' },
  { id: 'lab', label: 'Practice Lab', hint: 'Drill and track' },
  { id: 'vox', label: 'ClefVox', hint: 'Sing the words' },
  { id: 'import', label: 'Import', hint: 'Bring music in' },
];

export default function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const score = useApp((s) => s.score);
  const error = useApp((s) => s.error);
  const seedShelf = useApp((s) => s.seedShelf);
  const refreshLibrary = useApp((s) => s.refreshLibrary);
  const refreshStats = useApp((s) => s.refreshStats);

  useEffect(() => {
    void (async () => {
      await seedShelf();
      await refreshLibrary();
      await refreshStats();
    })();
  }, [seedShelf, refreshLibrary, refreshStats]);

  // A file dropped anywhere on the window imports — no need to find the panel.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setView('import');
      // Hand off to the import panel via a custom event it listens for.
      window.dispatchEvent(new CustomEvent('clefnotes:file', { detail: e.dataTransfer.files[0] }));
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [setView]);

  return (
    <div className="grain flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b-[1.5px] border-ink bg-paper px-4 py-2">
        <button
          className="flex items-center gap-2 font-display text-[15px] font-extrabold tracking-[-0.02em]"
          onClick={() => setView('library')}
          title="ClefNotes"
        >
          <span
            className="inline-block h-[11px] w-[11px] rounded-full"
            style={{ background: 'rgb(var(--pink))', boxShadow: '5px 0 0 rgb(var(--blue))' }}
          />
          <span className="ml-[6px]">ClefNotes</span>
        </button>

        <nav className="flex flex-wrap gap-0.5">
          {TABS.map((t) => {
            const disabled = !score && (t.id === 'studio' || t.id === 'lab' || t.id === 'vox');
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                disabled={disabled}
                title={t.hint}
                aria-current={view === t.id ? 'page' : undefined}
                className={`rounded-sm px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] ${
                  view === t.id ? 'bg-ink text-paper' : 'text-ink2 hover:bg-ink hover:text-paper'
                } ${disabled ? 'cursor-not-allowed opacity-35 hover:bg-transparent hover:text-ink2' : ''}`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="lbl rounded-sm px-2 py-1 hover:bg-ink hover:text-paper"
            onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
            title="Light, dark, or follow the system"
          >
            {theme === 'system' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      {error && (
        <div className="shrink-0 border-b border-crit bg-panel px-4 py-2 text-[13.5px] text-ink2">
          <span className="lbl mr-2" style={{ color: 'rgb(var(--crit))' }}>
            Problem
          </span>
          {error}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-auto">
        {view === 'library' && <Library />}
        {view === 'import' && <ImportPanel />}
        {view === 'studio' && <Studio />}
        {view === 'lab' && <PracticeLab />}
        {view === 'vox' && <VoxPanel />}
      </main>
    </div>
  );
}
