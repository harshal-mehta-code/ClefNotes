import { useState } from 'react';
import { useApp } from '../../state/store';
import { encodeShareLink } from '../../lib/share/link';

/**
 * Share the score, the mix and the loop as one link.
 *
 * The use case is concrete: a section leader sets up a learning track with the
 * altos loud and bars 41–56 looping, and sends that exact state to eleven
 * people. It arrives set up, so nobody has to be talked through the controls.
 */
export default function ShareButton() {
  const score = useApp((s) => s.score);
  const mixes = useApp((s) => s.mixes);
  const transport = useApp((s) => s.transport);
  const loopBars = useApp((s) => s.loopBars);
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  if (!score) return null;

  const share = async () => {
    try {
      const url = await encodeShareLink({
        v: 1,
        title: score.title,
        composer: score.composer,
        musicXml: score.musicXml,
        mixes,
        bpm: Math.round(transport.bpm),
        loop: loopBars,
      });
      // navigator.share on phones, clipboard everywhere else.
      if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ title: `${score.title} — ClefNotes`, url });
        setState('copied');
      } else {
        await navigator.clipboard.writeText(url);
        setState('copied');
        setMessage(`Link copied · ${Math.round(url.length / 1024)} KB`);
      }
      window.setTimeout(() => {
        setState('idle');
        setMessage(null);
      }, 3200);
    } catch (e) {
      setState('error');
      setMessage(e instanceof Error ? e.message : 'That link could not be made.');
      window.setTimeout(() => {
        setState('idle');
        setMessage(null);
      }, 6000);
    }
  };

  return (
    <div className="relative">
      <button
        className={`btn ${state === 'copied' ? 'btn-on' : ''}`}
        onClick={() => void share()}
        title="Copy a link containing this score, its mix and its loop"
      >
        {state === 'copied' ? 'Copied' : 'Share'}
      </button>
      {message && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-64 border-[1.5px] border-ink bg-panel p-2 text-[12.5px] leading-snug text-ink2 shadow-stamp"
          role="status"
        >
          {message}
        </div>
      )}
    </div>
  );
}
