import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../lib/audio/engine';
import { vowelLabel } from '../../lib/audio/clefvox';
import { inkVar } from '../../lib/score/types';

/**
 * The lyric bar.
 *
 * Shows the words of one part with the current syllable lit, plus the vowel
 * ClefVox will actually sing — which doubles as a way to see why a syllable
 * came out sounding odd.
 */
export default function Karaoke({ showVowels }: { showVowels?: boolean }) {
  const score = useApp((s) => s.score);
  const [partIndex, setPartIndex] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const lyricParts = useMemo(
    () => (score?.parts ?? []).filter((p) => p.hasLyrics),
    [score],
  );

  useEffect(() => {
    if (!lyricParts.length) {
      setPartIndex(null);
      return;
    }
    setPartIndex((cur) => (cur != null && lyricParts.some((p) => p.index === cur) ? cur : lyricParts[0].index));
  }, [lyricParts]);

  const words = useMemo(() => {
    if (!score || partIndex == null) return [];
    return score.notes
      .filter((n) => n.part === partIndex && n.syllable)
      .sort((a, b) => a.q - b.q);
  }, [score, partIndex]);

  useEffect(() => {
    if (!words.length) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const q = engine.getState().q;
      let current: string | null = null;
      for (const n of words) {
        if (q >= n.q - 0.02 && q < n.q + n.qDur) {
          current = n.id;
          break;
        }
        if (n.q > q) break;
      }
      setActiveId((prev) => (prev === current ? prev : current));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [words]);

  useEffect(() => {
    if (!activeId || !stripRef.current) return;
    const el = stripRef.current.querySelector(`[data-syl="${activeId}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  if (!score || !lyricParts.length || partIndex == null) return null;

  return (
    <div className="flex items-center gap-3 border-t-[1.5px] border-ink bg-panel px-3 py-2">
      <select
        className="field shrink-0"
        value={partIndex}
        onChange={(e) => setPartIndex(Number(e.target.value))}
        aria-label="Which part's lyrics to follow"
      >
        {lyricParts.map((p) => (
          <option key={p.index} value={p.index}>
            {p.name}
          </option>
        ))}
      </select>
      <div
        ref={stripRef}
        className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto py-0.5"
        style={{ scrollbarWidth: 'none' }}
      >
        {words.map((n) => {
          const on = n.id === activeId;
          return (
            <span
              key={n.id}
              data-syl={n.id}
              className="shrink-0 border px-1.5 py-1 text-center leading-tight"
              style={{
                background: on ? inkVar(partIndex) : 'rgb(var(--panel-2))',
                borderColor: on ? inkVar(partIndex) : 'rgb(var(--rule-2))',
                color: on ? '#fff' : 'rgb(var(--ink-2))',
                minWidth: 34,
              }}
            >
              <span className="block font-body text-[13px]">
                {n.syllable}
                {n.syllableContinues ? '-' : ''}
              </span>
              {showVowels && (
                <span className="lbl block" style={{ color: on ? 'rgba(255,255,255,.85)' : undefined }}>
                  {vowelLabel(n.syllable ?? '')}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
