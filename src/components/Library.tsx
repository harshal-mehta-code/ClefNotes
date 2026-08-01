import { useRef, useState } from 'react';
import { useApp } from '../state/store';

/**
 * The way in.
 *
 * One thing to do — drop a PDF — and a shelf of what you've already opened.
 * Everything stays on this device, so there is nothing to sign into and nothing
 * to upload.
 */
export default function Library() {
  const library = useApp((s) => s.library);
  const importFile = useApp((s) => s.importFile);
  const openScore = useApp((s) => s.openScore);
  const deleteScore = useApp((s) => s.deleteScore);
  const loading = useApp((s) => s.loading);
  const progress = useApp((s) => s.progress);
  const error = useApp((s) => s.error);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-8">
      <header className="mb-6">
        <h1 className="font-display text-[40px] font-extrabold leading-[0.95] tracking-[-0.04em]">
          Hear your
          <br />
          sheet music.
        </h1>
        <p className="mt-3 max-w-[52ch] text-[16px] leading-snug text-ink2">
          Drop in a PDF and every note on the page becomes playable. Tap one to hear it, drag across
          a phrase to hear the phrase. Your page stays exactly as printed.
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void importFile(f);
        }}
        onClick={() => !loading && inputRef.current?.click()}
        className={`mb-6 cursor-pointer border-[1.5px] border-dashed p-10 text-center ${
          dragging ? 'border-riso-pink bg-panel' : 'border-rule2 bg-panel/60'
        }`}
      >
        <div className="font-display text-[20px] font-bold tracking-tight">
          {loading ? (progress?.label ?? 'Reading…') : 'Drop a PDF here'}
        </div>
        <p className="mx-auto mt-1.5 max-w-[42ch] text-[14px] text-ink2">
          {loading ? 'Reading the staves and noteheads.' : 'Or click to choose one.'}
        </p>
        {loading && progress && (
          <div className="mx-auto mt-3 h-1.5 w-52 bg-sunk">
            <div
              className="h-full bg-riso-pink transition-none"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="mb-6 border-l-4 border-crit bg-panel px-4 py-3">
          <div className="lbl mb-1" style={{ color: 'rgb(var(--crit))' }}>
            Couldn't open that
          </div>
          <p className="text-[14.5px] leading-snug text-ink2">{error}</p>
        </div>
      )}

      {library.length > 0 && (
        <section>
          <div className="lbl mb-2">Your scores</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {library.map((s) => (
              <article key={s.id} className="flex flex-col border-[1.5px] border-ink bg-panel shadow-stamp">
                <button className="block" onClick={() => void openScore(s.id)}>
                  <img
                    src={s.pages?.[0]?.image}
                    alt=""
                    className="h-32 w-full border-b border-rule2 bg-white object-cover object-top"
                  />
                </button>
                <div className="flex flex-1 flex-col p-2.5">
                  <h2 className="mb-0.5 font-display text-[14px] font-bold leading-tight tracking-tight">
                    {s.title}
                  </h2>
                  <div className="lbl mb-2.5">
                    {s.pages?.length ?? 0} page{s.pages?.length === 1 ? '' : 's'} ·{' '}
                    {s.notes?.length ?? 0} notes
                  </div>
                  <div className="mt-auto flex gap-1.5">
                    <button className="btn btn-primary flex-1" onClick={() => void openScore(s.id)}>
                      Open
                    </button>
                    <button
                      className="btn btn-ghost"
                      title="Remove"
                      onClick={() => {
                        if (confirm(`Remove "${s.title}"?`)) void deleteScore(s.id);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-10 border-t border-rule pt-5">
        <p className="max-w-[62ch] text-[13.5px] leading-snug text-ink3">
          ClefNotes reads clean, printed sheet music. It finds the staves and the noteheads and works
          out pitch from the staff lines — it does not try to read rhythm, so nothing is ever played
          back at you as a performance. If a note is wrong, tap it and use the arrow keys. If one was
          missed, tap where it sits on the staff and you'll still hear the right pitch.
        </p>
      </footer>
    </div>
  );
}
