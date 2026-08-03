import { useRef, useState } from 'react';
import { useApp } from '../state/store';

/**
 * The way in.
 *
 * One thing to do — bring in a page — and a shelf of what you've already
 * opened. The page can be a PDF, a scan, a screenshot or a photo taken on the
 * spot, because the music you want to hear is as often on a stand in front of
 * you as it is in a file. Everything stays on this device, so there is nothing
 * to sign into and nothing to upload.
 */
export default function Library() {
  const library = useApp((s) => s.library);
  const importFiles = useApp((s) => s.importFiles);
  const openScore = useApp((s) => s.openScore);
  const deleteScore = useApp((s) => s.deleteScore);
  const loading = useApp((s) => s.loading);
  const progress = useApp((s) => s.progress);
  const error = useApp((s) => s.error);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length) void importFiles(files);
  };

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-8">
      <header className="mb-6">
        <h1 className="font-display text-[40px] font-extrabold leading-[0.95] tracking-[-0.04em]">
          Hear your
          <br />
          sheet music.
        </h1>
        <p className="mt-3 max-w-[52ch] text-[16px] leading-snug text-ink2">
          Bring in a PDF, or photograph the page on the stand, and every note on it becomes
          playable. Tap one to hear it; slide along a staff to hear the phrase run past. What you
          get back is your own page, exactly as printed.
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
          take(e.dataTransfer.files);
        }}
        onClick={() => !loading && pickRef.current?.click()}
        className={`mb-6 cursor-pointer border-[1.5px] border-dashed px-6 py-9 text-center ${
          dragging ? 'border-riso-pink bg-panel' : 'border-rule2 bg-panel/60'
        }`}
      >
        <div className="font-display text-[20px] font-bold tracking-tight">
          {loading ? (progress?.label ?? 'Reading…') : 'Drop a PDF or a photo here'}
        </div>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[14px] text-ink2">
          {loading
            ? 'Finding the staves and the noteheads.'
            : 'A scan, a screenshot, or a picture of the music in front of you.'}
        </p>
        {loading ? (
          progress && (
            <div className="mx-auto mt-3 h-1.5 w-52 bg-sunk">
              <div
                className="h-full bg-riso-pink transition-none"
                style={{ width: `${Math.round(progress.fraction * 100)}%` }}
              />
            </div>
          )
        ) : (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {/* Only where there is a camera to open. On a laptop the browser
                ignores `capture` and shows a file dialog, which is the button
                next to it doing the same thing twice. */}
            <button
              className="btn btn-primary hidden [@media(pointer:coarse)]:inline-block"
              onClick={(e) => {
                e.stopPropagation();
                cameraRef.current?.click();
              }}
            >
              Take a photo
            </button>
            <button
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                pickRef.current?.click();
              }}
            >
              Choose a file
            </button>
          </div>
        )}
        <input
          ref={pickRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
        {/* `capture` is what opens the camera rather than the photo library. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            take(e.target.files);
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
              <article
                key={s.id}
                className="flex flex-col border-[1.5px] border-ink bg-panel shadow-stamp"
              >
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

      <footer className="mt-10 space-y-2.5 border-t border-rule pt-5">
        <p className="max-w-[64ch] text-[13.5px] leading-snug text-ink3">
          ClefNotes reads printed sheet music. It finds the staves and the noteheads and works out
          pitch from the staff lines, the clef, the key signature and any sharp or flat printed on
          the note. It does not read rhythm, so nothing is ever played back at you as a performance.
        </p>
        <p className="max-w-[64ch] text-[13.5px] leading-snug text-ink3">
          Tapping a note names the pitch it is about to play, so you can check it against your page.
          If it disagrees, <b className="font-semibold">♭ ♮ ♯</b> say what is actually printed
          there, and the clef and key in the margin beside each staff are one tap to change.
        </p>
        <p className="max-w-[64ch] text-[13.5px] leading-snug text-ink3">
          <b className="font-semibold">Slide along a staff</b> to hear a phrase in order — press,
          hold for a moment, then glide. Where two voices share a staff, keep your finger high or
          low and you follow that line. Holding still without sliding sounds the pitch at that exact
          spot even where no note was found, which is how to play a notehead the app missed.
        </p>
        <p className="max-w-[64ch] text-[13.5px] leading-snug text-ink3">
          Photographs work when the page is square-on and filling the frame, in even light, with the
          music in focus. A slight tilt is straightened for you. Everything stays on this device —
          nothing is uploaded, and it all works offline.
        </p>
      </footer>
    </div>
  );
}
