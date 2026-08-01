import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import { getSetting, setSetting } from '../../lib/db/db';
import { SHELF, shelfXml } from '../../data/scores/shelf';

/**
 * First run.
 *
 * A new arrival should be hearing music within one click, not reading about
 * how to make it happen. So this is one screen, three sentences, and a button
 * that opens a real score — not a tour with arrows pointing at buttons.
 */
export default function Welcome() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadScore = useApp((s) => s.loadScore);

  useEffect(() => {
    void (async () => {
      const seen = await getSetting('welcomed', false);
      if (!seen) setShow(true);
    })();
  }, []);

  const dismiss = async () => {
    setShow(false);
    await setSetting('welcomed', true);
  };

  const start = async () => {
    setBusy(true);
    // Open the four-part chorale: it shows part isolation, lyrics and ClefVox
    // all at once, which is the whole pitch in one score.
    const entry = SHELF.find((s) => s.slug === 'ode-to-joy-satb') ?? SHELF[0];
    await setSetting('welcomed', true);
    setShow(false);
    await loadScore(shelfXml(entry), { source: 'bundled', slug: entry.slug, id: `shelf-${entry.slug}` });
    setBusy(false);
  };

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[450] flex items-center justify-center bg-[rgb(var(--sunk))]/80 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to ClefNotes"
    >
      <div className="w-full max-w-[520px] border-[1.5px] border-ink bg-panel p-6 shadow-stamp">
        <div className="lbl mb-2">Welcome</div>
        <h1 className="font-display text-[32px] font-extrabold leading-[0.95] tracking-[-0.035em]">
          Sheet music,
          <br />
          made audible.
        </h1>
        <p className="mt-3 max-w-[46ch] text-[15px] leading-snug text-ink2">
          Drop in a score and ClefNotes plays it — every part on its own track, every note lit as it
          sounds. Slow the hard bar down, mute your line and play along, or hear the words sung back
          to you.
        </p>

        <ul className="mt-4 flex flex-col gap-1.5">
          {[
            ['Nothing to sign up for', 'Your scores stay on this device.'],
            ['Nothing to install', 'It works offline once opened.'],
            ['Nothing to pay', 'All of it, always.'],
          ].map(([title, sub]) => (
            <li key={title} className="flex items-baseline gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-riso-pink" />
              <span className="text-[14px] leading-snug">
                <span className="font-display font-bold">{title}</span>{' '}
                <span className="text-ink2">{sub}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={() => void start()} disabled={busy}>
            {busy ? 'Opening…' : 'Play something now →'}
          </button>
          <button className="btn btn-ghost" onClick={() => void dismiss()}>
            I'll look around
          </button>
          <span className="lbl ml-auto">⌘K for everything</span>
        </div>
      </div>
    </div>
  );
}
