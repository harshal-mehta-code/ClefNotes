import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { readScoreFile } from '../../lib/import/files';
import { fetchScoreFromUrl, type RasterPage } from '../../lib/import/pdf';
import { Label } from '../ui/primitives';

/**
 * Import.
 *
 * Four tiers, ordered by how much they can be trusted, and the screen says
 * which one you got. Being told "this was recognised, check it" is far better
 * than silently receiving wrong notes.
 */
export default function ImportPanel() {
  const loadScore = useApp((s) => s.loadScore);
  const setView = useApp((s) => s.setView);

  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pages, setPages] = useState<RasterPage[]>([]);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setNote(null);
      setPages([]);
      setStatus('Reading…');
      try {
        const result = await readScoreFile(file, setStatus);
        if ('pages' in result && Array.isArray(result.pages)) setPages(result.pages as RasterPage[]);
        setStatus('Engraving…');
        await loadScore(result.musicXml, {
          source: result.source,
          id: `${file.name.replace(/\.[^.]+$/, '')}-${Date.now().toString(36)}`,
        });
        setNote(result.note ?? null);
        setStatus(null);
      } catch (e) {
        setStatus(null);
        setError(e instanceof Error ? e.message : 'That file could not be read.');
      }
    },
    [loadScore],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  // A file dropped anywhere on the window arrives here.
  useEffect(() => {
    const onWindowFile = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (file) void handleFile(file);
    };
    window.addEventListener('clefnotes:file', onWindowFile);
    return () => window.removeEventListener('clefnotes:file', onWindowFile);
  }, [handleFile]);

  const onUrl = async () => {
    if (!url.trim()) return;
    setError(null);
    setStatus('Fetching…');
    try {
      const file = await fetchScoreFromUrl(url.trim(), setStatus);
      await handleFile(file);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : 'That link could not be fetched.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[900px] px-5 py-8">
      <header className="mb-6">
        <div className="lbl mb-1.5">Import</div>
        <h1 className="font-display text-[36px] font-extrabold leading-none tracking-[-0.035em]">
          Bring your music in
        </h1>
        <p className="mt-2 max-w-[58ch] text-[15px] text-ink2">
          Nothing leaves this device — every format below is read in your browser.
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`mb-5 cursor-pointer border-[1.5px] border-dashed p-10 text-center transition-none ${
          dragging ? 'border-riso-pink bg-panel' : 'border-rule2 bg-panel/60'
        }`}
      >
        <div className="font-display text-[20px] font-bold tracking-tight">
          {status ?? 'Drop a score here'}
        </div>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[14px] text-ink2">
          MusicXML, .mxl, MIDI or PDF. Or click to choose a file.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xml,.musicxml,.mxl,.mid,.midi,.pdf,.abc,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input
          className="field min-w-0 flex-1"
          placeholder="…or paste a link to a MusicXML / MIDI / PDF file"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void onUrl()}
          aria-label="Score URL"
        />
        <button className="btn" onClick={() => void onUrl()} disabled={!url.trim()}>
          Fetch
        </button>
      </div>

      {error && (
        <div className="mb-5 border-l-4 border-crit bg-panel px-4 py-3">
          <div className="lbl mb-1" style={{ color: 'rgb(var(--crit))' }}>
            Couldn't import
          </div>
          <p className="text-[14.5px] leading-snug text-ink2">{error}</p>
        </div>
      )}

      {note && (
        <div className="mb-5 border-l-4 border-riso-mint bg-panel px-4 py-3">
          <div className="lbl mb-1" style={{ color: 'rgb(var(--mint))' }}>
            Imported
          </div>
          <p className="text-[14.5px] leading-snug text-ink2">{note}</p>
          <button className="btn mt-2.5" onClick={() => setView('studio')}>
            Open in Studio →
          </button>
        </div>
      )}

      {pages.length > 0 && (
        <section className="mb-6">
          <Label className="mb-2">The original, for checking against</Label>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {pages.map((p, i) => (
              <img
                key={i}
                src={p.preview}
                alt={`Page ${i + 1} of the imported PDF`}
                className="h-56 border border-rule2 bg-white"
              />
            ))}
          </div>
        </section>
      )}

      <section className="border-t border-rule pt-6">
        <Label className="mb-3">How each format comes through</Label>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {[
            ['MusicXML · .mxl', 'Exact. Every note, lyric and marking, straight in.'],
            ['MIDI', 'Exact pitch and rhythm. Notation details are inferred.'],
            [
              'PDF with a score inside',
              'Exact. MuseScore attaches the real file to its PDFs — ClefNotes finds it.',
            ],
            [
              'PDF · recognised',
              'Best effort. Reads clean printed scores; check it against the page.',
            ],
          ].map(([term, def]) => (
            <div key={term}>
              <dt className="font-display text-[13.5px] font-bold tracking-tight">{term}</dt>
              <dd className="text-[13.5px] leading-snug text-ink2">{def}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-[62ch] text-[13.5px] leading-snug text-ink3">
          The fastest route to a perfect import is a MusicXML export. Most notation apps — MuseScore,
          Sibelius, Finale, Dorico — can produce one, and every note then arrives exactly as written.
        </p>
      </section>
    </div>
  );
}
