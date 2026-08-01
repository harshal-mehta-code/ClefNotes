import { useEffect, useRef } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../lib/audio/engine';
import { PART_INKS } from '../../lib/score/types';

/**
 * A piano keyboard that lights up as the score plays.
 *
 * Notation tells you the name of a note; this tells you *where it is*. For
 * anyone still translating dots into fingers, it closes that gap faster than
 * any amount of staff-reading practice — and it's the view that makes a score
 * immediately legible to someone who can't yet read one.
 *
 * Keys are also playable, so it doubles as a way to check a pitch by ear.
 */

const WHITE_PATTERN = [0, 2, 4, 5, 7, 9, 11];
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

/** Count white keys from C-1 up to (not including) a midi note. */
function whiteIndex(midi: number): number {
  const octave = Math.floor(midi / 12);
  const pc = ((midi % 12) + 12) % 12;
  let n = octave * 7;
  for (const w of WHITE_PATTERN) if (w < pc) n++;
  return n;
}

export default function Keyboard({ height = 96 }: { height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const score = useApp((s) => s.score);
  const mixes = useApp((s) => s.mixes);
  const rangeRef = useRef({ lo: 48, hi: 84 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !score) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Show the score's actual compass, rounded out to whole octaves so the
    // keyboard reads as a keyboard rather than an arbitrary slice.
    const lowest = Math.min(...score.parts.map((p) => p.lowMidi), 60);
    const highest = Math.max(...score.parts.map((p) => p.highMidi), 72);
    const lo = Math.max(21, Math.floor((lowest - 2) / 12) * 12);
    const hi = Math.min(108, Math.ceil((highest + 3) / 12) * 12 - 1);
    rangeRef.current = { lo, hi };

    const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const inks = PART_INKS.map((n) => css(`--${n}`));

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const whiteCount = whiteIndex(hi + 1) - whiteIndex(lo);
      if (whiteCount <= 0) return;
      const kw = w / whiteCount;
      const baseWhite = whiteIndex(lo);

      // Which part is sounding each pitch right now.
      const q = engine.getState().q;
      const anySolo = mixes.some((m) => m.solo);
      const lit = new Map<number, number>();
      for (const n of score.notes) {
        if (n.q > q) break;
        if (q >= n.q + n.qDur) continue;
        const mix = mixes[n.part];
        const audible = !mix ? true : anySolo ? mix.solo : !mix.muted;
        if (!audible) continue;
        const sounding = n.midi + (mix?.transpose ?? 0);
        if (!lit.has(sounding)) lit.set(sounding, n.part);
      }

      // White keys first, then black on top — the way a keyboard is built.
      for (let m = lo; m <= hi; m++) {
        if (isBlack(m)) continue;
        const x = (whiteIndex(m) - baseWhite) * kw;
        const part = lit.get(m);
        ctx.fillStyle =
          part != null ? `rgb(${inks[part % inks.length]})` : `rgb(${css('--panel')})`;
        ctx.fillRect(x, 0, kw - 1, h);
        ctx.strokeStyle = `rgb(${css('--rule-2')})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, 0.5, kw - 2, h - 1);
        // Label every C so the eye can find its place.
        if (m % 12 === 0 && kw > 13) {
          ctx.fillStyle = part != null ? '#fff' : `rgb(${css('--ink-3')})`;
          ctx.font = '8px ui-monospace, monospace';
          ctx.fillText(`C${Math.floor(m / 12) - 1}`, x + 2, h - 4);
        }
      }

      const bh = h * 0.62;
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) continue;
        const x = (whiteIndex(m) - baseWhite) * kw - kw * 0.3;
        const part = lit.get(m);
        ctx.fillStyle = part != null ? `rgb(${inks[part % inks.length]})` : `rgb(${css('--ink')})`;
        ctx.fillRect(x, 0, kw * 0.62, bh);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [score, mixes]);

  /** Clicking a key sounds it — a quick way to check a pitch by ear. */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!score) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { lo, hi } = rangeRef.current;
    const whiteCount = whiteIndex(hi + 1) - whiteIndex(lo);
    const kw = rect.width / whiteCount;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const baseWhite = whiteIndex(lo);

    // Black keys sit on top, so test them first.
    if (y < rect.height * 0.62) {
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) continue;
        const kx = (whiteIndex(m) - baseWhite) * kw - kw * 0.3;
        if (x >= kx && x <= kx + kw * 0.62) {
          void engine.preview(m, 0, 0.7);
          return;
        }
      }
    }
    const wi = Math.floor(x / kw) + baseWhite;
    for (let m = lo; m <= hi; m++) {
      if (!isBlack(m) && whiteIndex(m) === wi) {
        void engine.preview(m, 0, 0.7);
        return;
      }
    }
  };

  if (!score) return null;
  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      className="w-full cursor-pointer touch-none"
      style={{ height, background: 'rgb(var(--sunk))' }}
      aria-label="Piano keyboard showing the notes currently sounding"
    />
  );
}
