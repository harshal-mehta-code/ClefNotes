import { useEffect, useRef } from 'react';
import { useApp } from '../state/store';
import { player } from '../lib/audio/player';

/**
 * A piano along the bottom.
 *
 * Notation tells you a note's name; this tells you where it is. For anyone
 * still translating dots into fingers that gap is the whole difficulty, and
 * seeing the key light as the note sounds closes it. The keys are playable too,
 * so you can check a pitch by ear without touching the page.
 */

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

function whiteIndex(midi: number): number {
  const octave = Math.floor(midi / 12);
  const pc = ((midi % 12) + 12) % 12;
  let n = octave * 7;
  for (const w of WHITE) if (w < pc) n++;
  return n;
}

export default function Keys({ height = 72 }: { height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const score = useApp((s) => s.score);
  const sound = useApp((s) => s.sound);
  const range = useRef({ lo: 48, hi: 84 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Show the compass the score actually uses, rounded to whole octaves.
    let lo = 48;
    let hi = 84;
    if (score?.staves.length) {
      const pitches: number[] = [];
      for (const s of score.staves) {
        // Bottom line to top line, plus a couple of ledger lines either way.
        pitches.push(s.clef === 'bass' ? 43 : s.clef === 'treble8' ? 52 : s.clef === 'alto' ? 53 : 64);
        pitches.push(s.clef === 'bass' ? 69 : s.clef === 'treble8' ? 76 : s.clef === 'alto' ? 77 : 84);
      }
      lo = Math.max(21, Math.floor((Math.min(...pitches) - 6) / 12) * 12);
      hi = Math.min(108, Math.ceil((Math.max(...pitches) + 6) / 12) * 12 - 1);
    }
    range.current = { lo, hi };

    const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

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

      const count = whiteIndex(hi + 1) - whiteIndex(lo);
      if (count <= 0) return;
      const kw = w / count;
      const base = whiteIndex(lo);
      const lit = new Set(player.sounding());

      for (let m = lo; m <= hi; m++) {
        if (isBlack(m)) continue;
        const x = (whiteIndex(m) - base) * kw;
        ctx.fillStyle = lit.has(m) ? `rgb(${css('--pink')})` : `rgb(${css('--panel')})`;
        ctx.fillRect(x, 0, kw - 1, h);
        ctx.strokeStyle = `rgb(${css('--rule-2')})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, 0.5, kw - 2, h - 1);
        if (m % 12 === 0 && kw > 13) {
          ctx.fillStyle = lit.has(m) ? '#fff' : `rgb(${css('--ink-3')})`;
          ctx.font = '8px ui-monospace, monospace';
          ctx.fillText(`C${Math.floor(m / 12) - 1}`, x + 2, h - 4);
        }
      }

      const bh = h * 0.62;
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) continue;
        const x = (whiteIndex(m) - base) * kw - kw * 0.3;
        ctx.fillStyle = lit.has(m) ? `rgb(${css('--pink')})` : `rgb(${css('--ink')})`;
        ctx.fillRect(x, 0, kw * 0.62, bh);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const { lo, hi } = range.current;
    const count = whiteIndex(hi + 1) - whiteIndex(lo);
    const kw = rect.width / count;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const base = whiteIndex(lo);

    if (y < rect.height * 0.62) {
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) continue;
        const kx = (whiteIndex(m) - base) * kw - kw * 0.3;
        if (x >= kx && x <= kx + kw * 0.62) {
          sound(m);
          return;
        }
      }
    }
    const wi = Math.floor(x / kw) + base;
    for (let m = lo; m <= hi; m++) {
      if (!isBlack(m) && whiteIndex(m) === wi) {
        sound(m);
        return;
      }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onDown}
      className="w-full cursor-pointer touch-none"
      style={{ height, background: 'rgb(var(--sunk))' }}
      aria-label="Piano keyboard — the notes you play light up"
    />
  );
}
