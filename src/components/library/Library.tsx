import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { SHELF } from '../../data/scores/shelf';
import { exportLibrary, importLibrary, type StoredScore } from '../../lib/db/db';
import { generatePhrase, generateWarmup, GRADES, seedFromDate } from '../../lib/score/generate';
import { Empty, Label } from '../ui/primitives';

function fmtDate(ts: number) {
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SOURCE_LABEL: Record<string, string> = {
  bundled: 'Shelf',
  musicxml: 'MusicXML',
  midi: 'MIDI',
  'pdf-embedded': 'PDF · exact',
  omr: 'PDF · recognised',
  generated: 'Generated',
};

export default function Library() {
  const library = useApp((s) => s.library);
  const refreshLibrary = useApp((s) => s.refreshLibrary);
  const loadScore = useApp((s) => s.loadScore);
  const deleteScore = useApp((s) => s.deleteScore);
  const setView = useApp((s) => s.setView);
  const streak = useApp((s) => s.streak);
  const refreshStats = useApp((s) => s.refreshStats);

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void refreshLibrary();
    void refreshStats();
  }, [refreshLibrary, refreshStats]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (s) => s.title.toLowerCase().includes(q) || s.composer.toLowerCase().includes(q),
    );
  }, [library, query]);

  const open = async (row: StoredScore) => {
    setBusy(row.id);
    await loadScore(row.musicXml, { source: row.source, slug: row.slug, id: row.id });
    setBusy(null);
  };

  const openDaily = async () => {
    setBusy('daily');
    const seed = seedFromDate();
    const level = Math.min(GRADES.length, 2 + (seed % 3));
    const phrase = generatePhrase(level, seed);
    await loadScore(phrase.musicXml, { source: 'generated', id: `daily-${seed}` });
    setBusy(null);
  };

  const openWarmup = async () => {
    setBusy('warmup');
    await loadScore(generateWarmup(0), { source: 'generated', id: `warmup-c` });
    setBusy(null);
  };

  const doExport = async () => {
    const blob = await exportLibrary();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clefnotes-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    try {
      const { scores } = await importLibrary(file);
      await refreshLibrary();
      alert(`Restored ${scores} score${scores === 1 ? '' : 's'}.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'That file could not be read.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-7">
      <header className="mb-7 flex flex-wrap items-end gap-4">
        <div>
          <div className="lbl mb-1.5">Your library</div>
          <h1 className="font-display text-[38px] font-extrabold leading-none tracking-[-0.035em]">
            {library.length} score{library.length === 1 ? '' : 's'}
          </h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className="field w-44"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the library"
          />
          <button className="btn btn-primary" onClick={() => setView('import')}>
            + Import
          </button>
        </div>
      </header>

      {streak && (
        <div className="mb-7 flex flex-wrap items-center gap-5 border-[1.5px] border-ink bg-panel px-4 py-3">
          <div>
            <Label>Streak</Label>
            <div className="num text-[22px] font-bold leading-tight">
              {streak.current} <span className="lbl">days</span>
            </div>
          </div>
          <div>
            <Label>Today</Label>
            <div className="num text-[22px] font-bold leading-tight">
              {Math.round(streak.todaySeconds / 60)} <span className="lbl">min</span>
            </div>
          </div>
          <div>
            <Label>XP</Label>
            <div className="num text-[22px] font-bold leading-tight">{streak.xp}</div>
          </div>
          <div className="ml-auto flex gap-[3px]">
            {streak.days.map((d) => (
              <span
                key={d.date}
                title={`${d.date} · ${Math.round(d.seconds / 60)} min`}
                className="h-4 w-2.5"
                style={{
                  background:
                    d.seconds >= 600
                      ? 'rgb(var(--gold))'
                      : d.seconds >= 60
                        ? 'rgb(var(--mint))'
                        : 'rgb(var(--sunk))',
                }}
              />
            ))}
          </div>
        </div>
      )}

      <section className="mb-7">
        <Label className="mb-2">Every day</Label>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => void openDaily()} disabled={busy === 'daily'}>
            {busy === 'daily' ? 'Generating…' : "Today's sight-reading"}
          </button>
          <button className="btn" onClick={() => void openWarmup()} disabled={busy === 'warmup'}>
            Warm-up scale
          </button>
        </div>
      </section>

      {filtered.length === 0 ? (
        <Empty title={query ? 'Nothing matches that' : 'Your library is empty'}>
          {query ? 'Try a different search.' : 'Import a score, or open one from the shelf below.'}
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(206px,1fr))] gap-3">
          {filtered.map((row) => {
            const shelf = SHELF.find((s) => s.slug === row.slug);
            return (
              <article
                key={row.id}
                className="group flex flex-col border-[1.5px] border-ink bg-panel p-3 shadow-stamp transition-none"
              >
                <div className="lbl mb-1.5">{SOURCE_LABEL[row.source] ?? row.source}</div>
                <h2 className="mb-0.5 font-display text-[15px] font-bold leading-tight tracking-tight">
                  {row.title}
                </h2>
                <p className="mb-2 text-[12.5px] leading-snug text-ink2">{row.composer}</p>
                {shelf && <p className="mb-2 text-[12px] italic leading-snug text-ink3">{shelf.showcases}</p>}
                <div className="lbl mt-auto mb-2.5">
                  {row.partCount} part{row.partCount === 1 ? '' : 's'} · {fmtDate(row.openedAt)}
                </div>
                <div className="flex gap-1.5">
                  <button
                    className="btn btn-primary flex-1"
                    onClick={() => void open(row)}
                    disabled={busy === row.id}
                  >
                    {busy === row.id ? 'Opening…' : 'Open'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    title="Remove from library"
                    onClick={() => {
                      if (confirm(`Remove "${row.title}" from your library?`)) void deleteScore(row.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <footer className="mt-10 flex flex-wrap items-center gap-2 border-t border-rule pt-5">
        <Label>Your library lives on this device only</Label>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-ghost" onClick={() => void doExport()}>
            Export library
          </button>
          <label className="btn btn-ghost cursor-pointer">
            Restore
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </footer>
    </div>
  );
}
