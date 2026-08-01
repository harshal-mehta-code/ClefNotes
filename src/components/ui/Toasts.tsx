import { useEffect } from 'react';
import { useApp } from '../../state/store';

/**
 * Achievement toasts.
 *
 * They arrive stamped in the badge's own ink, sit long enough to read, and go
 * away on their own. An unlock should feel like a small round of applause, not
 * a dialog to dismiss.
 */
export default function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) => window.setTimeout(() => dismiss(t.id), 6000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (!toasts.length) return null;

  return (
    // Sits clear of the transport on a phone, where it would otherwise cover
    // the play button — the one control nobody should have to hunt for.
    <div className="pointer-events-none fixed bottom-32 right-3 z-[400] flex flex-col gap-2 sm:bottom-4 sm:right-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className="pointer-events-auto w-[min(280px,calc(100vw-1.5rem))] border-[1.5px] border-ink bg-panel p-3 text-left shadow-stamp"
          style={{ animation: 'cn-toast-in 240ms ease-out' }}
        >
          <div className="flex items-center gap-2">
            <span className="h-7 w-7 shrink-0 rounded-full" style={{ background: `rgb(var(--${t.ink}))` }} />
            <div className="min-w-0">
              <div className="lbl" style={{ color: `rgb(var(--${t.ink}))` }}>
                Achievement
              </div>
              <div className="font-display text-[15px] font-bold leading-tight tracking-tight">{t.name}</div>
            </div>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-snug text-ink2">{t.hint}</p>
        </button>
      ))}
    </div>
  );
}
