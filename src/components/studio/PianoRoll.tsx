import { useEffect, useRef } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../lib/audio/engine';
import { PART_INKS } from '../../lib/score/types';

/**
 * Piano roll.
 *
 * Notation tells you what to play; this tells you what it *sounds* like —
 * contour, density, which parts overlap. Drawn on canvas because it repaints
 * every frame and there can be thousands of notes.
 */
export default function PianoRoll() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const score = useApp((s) => s.score);
  const mixes = useApp((s) => s.mixes);
  const seekQ = useApp((s) => s.seekQ);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !score) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const inks = PART_INKS.map((name) =>
      getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim(),
    );
    const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const anySolo = mixes.some((m) => m.solo);
      const state = engine.getState();
      const q = state.q;

      // A window that follows the playhead, showing roughly eight bars.
      const windowQ = Math.max(8, (score.beatsPerBar || 4) * 2);
      const startQ = Math.max(0, q - windowQ * 0.28);
      const pxPerQ = w / windowQ;

      const lo = Math.min(...score.parts.map((p) => p.lowMidi), 48) - 2;
      const hi = Math.max(...score.parts.map((p) => p.highMidi), 72) + 2;
      const span = Math.max(12, hi - lo);
      const rowH = h / span;

      // Bar lines and a faint stripe per octave keep the eye oriented.
      ctx.fillStyle = `rgb(${css('--sunk')})`;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `rgb(${css('--rule')})`;
      ctx.lineWidth = 1;
      for (let m = 1; m <= score.measureCount; m++) {
        const bar = score.measureQ.get(m);
        if (!bar) continue;
        const x = (bar.start - startQ) * pxPerQ;
        if (x < -40 || x > w + 40) continue;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgb(${css('--ink-3')})`;
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(String(m), x + 3, 11);
      }

      // Notes.
      for (const n of score.notes) {
        const x = (n.q - startQ) * pxPerQ;
        const nw = Math.max(2, n.qDur * pxPerQ - 1.5);
        if (x + nw < 0 || x > w) continue;
        const mix = mixes[n.part];
        const audible = !mix ? true : anySolo ? mix.solo : !mix.muted;
        const y = h - (n.midi - lo + 1) * rowH;
        const sounding = q >= n.q && q < n.q + n.qDur;

        ctx.globalAlpha = audible ? (sounding ? 1 : 0.72) : 0.16;
        ctx.fillStyle = sounding ? `rgb(${css('--pink')})` : `rgb(${inks[n.part % inks.length]})`;
        const height = Math.max(2.5, rowH - 1.5);
        ctx.fillRect(x, y, nw, height);
        if (sounding) {
          ctx.globalAlpha = 0.32;
          ctx.fillRect(x - 3, y - 3, nw + 6, height + 6);
        }
      }
      ctx.globalAlpha = 1;

      // Playhead.
      const px = (q - startQ) * pxPerQ;
      ctx.strokeStyle = `rgb(${css('--pink')})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [score, mixes]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!score) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const state = engine.getState();
    const windowQ = Math.max(8, (score.beatsPerBar || 4) * 2);
    const startQ = Math.max(0, state.q - windowQ * 0.28);
    const pxPerQ = rect.width / windowQ;
    seekQ(Math.max(0, startQ + (e.clientX - rect.left) / pxPerQ));
  };

  if (!score) return null;
  return (
    <canvas
      ref={canvasRef}
      onClick={onClick}
      className="h-full w-full cursor-pointer"
      aria-label="Piano roll view"
    />
  );
}
