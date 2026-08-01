import { useEffect } from 'react';
import { useApp, type ViewId } from './state/store';
import Library from './components/library/Library';
import ImportPanel from './components/library/ImportPanel';
import Studio from './components/studio/Studio';
import PracticeLab from './components/lab/PracticeLab';
import VoxPanel from './components/vox/VoxPanel';
import Toasts from './components/ui/Toasts';
import CommandPalette from './components/ui/CommandPalette';
import Welcome from './components/ui/Welcome';
import { clearShareHash, readShareLink } from './lib/share/link';

// Only "Practice Lab" needs shortening for a phone. The rest keep their names:
// a tab called "Play" next to a Play button is two different things wearing the
// same word.
const TABS: Array<{ id: ViewId; label: string; short: string; hint: string }> = [
  { id: 'library', label: 'Library', short: 'Library', hint: 'Your scores' },
  { id: 'studio', label: 'Studio', short: 'Studio', hint: 'Play and mix' },
  { id: 'lab', label: 'Practice Lab', short: 'Practise', hint: 'Drill and track' },
  { id: 'vox', label: 'ClefVox', short: 'ClefVox', hint: 'Sing the words' },
  { id: 'import', label: 'Import', short: 'Import', hint: 'Bring music in' },
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
      // A shared link takes priority: someone followed it to hear something
      // specific, so open that before anything else.
      const shared = await readShareLink();
      if (shared) {
        clearShareHash();
        await useApp.getState().loadScore(shared.musicXml, {
          source: 'musicxml',
          id: `shared-${Date.now().toString(36)}`,
        });
        if (shared.mixes?.length) useApp.getState().setAllMixes(shared.mixes);
        if (shared.bpm) useApp.getState().patchTransport({ bpm: shared.bpm });
        if (shared.loop) useApp.getState().setLoopBars(shared.loop);
      }
      await seedShelf();
      await refreshLibrary();
      await refreshStats();
      await useApp.getState().checkAchievements();
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
      {/* One row, always. On a phone the chrome has to earn its height — three
          wrapped rows of navigation was most of the screen before any music. */}
      <header className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-ink bg-paper px-3 py-1.5">
        <button
          className="flex shrink-0 items-center font-display text-[14px] font-extrabold tracking-[-0.02em]"
          onClick={() => setView('library')}
          title="ClefNotes"
        >
          <span
            className="inline-block h-[10px] w-[10px] rounded-full"
            style={{ background: 'rgb(var(--pink))', boxShadow: '5px 0 0 rgb(var(--blue))' }}
          />
          <span className="ml-[11px] hidden sm:inline">ClefNotes</span>
        </button>

        <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map((t) => {
            const disabled = !score && (t.id === 'studio' || t.id === 'lab' || t.id === 'vox');
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                disabled={disabled}
                title={t.hint}
                aria-current={view === t.id ? 'page' : undefined}
                className={`shrink-0 rounded-sm px-1.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] sm:px-2 sm:text-[10.5px] sm:tracking-[0.1em] ${
                  view === t.id ? 'bg-ink text-paper' : 'text-ink2 hover:bg-ink hover:text-paper'
                } ${disabled ? 'cursor-not-allowed opacity-35 hover:bg-transparent hover:text-ink2' : ''}`}
              >
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          className="lbl shrink-0 rounded-sm px-2 py-1 hover:bg-ink hover:text-paper"
          onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
          title="Light, dark, or follow the system"
        >
          {theme === 'system' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'}
        </button>
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

      <Toasts />
      <CommandPalette />
      <Welcome />
    </div>
  );
}
