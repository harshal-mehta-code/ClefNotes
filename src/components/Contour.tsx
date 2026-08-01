import { useEffect, useRef } from 'react';
import { useApp } from '../state/store';
import { noteMidi, type PageScore } from '../lib/detect/types';

/**
 * The piano roll.
 *
 * Reading pitch off a stave is a skill; seeing it as height is instant. Laying
 * the notes out by position across the page and pitch up the side shows the
 * shape of the music at a glance — where it climbs, where it sits, how the
 * parts stack against each other.
 *
 * It shows **the page you are looking at**, not the whole score. A seven-page
 * chart is a thousand notes, and a thousand dots across one strip is a cloud.
 * Scrolling the sheet scrolls this too, so it always describes what is in front
 * of you.
 *
 * The horizontal axis is *where the note is printed*, not a timeline. That is a
 * deliberate limit: reading durations off a page is the thing that kept
 * producing wrong music, so nothing here pretends to know them.
 */
export default function Contour({ height = 132 }: { height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const score = useApp((s) => s.score);
  const selected = useApp((s) => s.selected);
  const visiblePage = useApp((s) => s.visiblePage);
  const select = useApp((s) => s.select);
  const soundNote = useApp((s) => s.soundNote);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !score) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const inks = ['--blue', '--pink', '--mint', '--gold', '--violet'];

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
      ctx.fillStyle = `rgb(${css('--sunk')})`;
      ctx.fillRect(0, 0, w, h);
      ctx.font = '8px ui-monospace, monospace';

      const placed = layout(score, w, visiblePage);
      if (!placed.length) {
        ctx.fillStyle = `rgb(${css('--ink-3')})`;
        ctx.fillText(`No notes found on page ${visiblePage + 1}`, 6, h / 2);
        return;
      }
      const pitches = placed.map((p) => p.midi);
      const lo = Math.min(...pitches) - 2;
      const hi = Math.max(...pitches) + 2;
      const span = Math.max(6, hi - lo);

      // A faint line at each octave C keeps the vertical scale readable.
      ctx.strokeStyle = `rgb(${css('--rule')})`;
      ctx.lineWidth = 1;
      for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) {
        const y = h - ((m - lo) / span) * h;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgb(${css('--ink-3')})`;
        ctx.fillText(`C${Math.floor(m / 12) - 1}`, 2, y - 2);
      }

      // A tick where each system begins, so the strip reads as lines of music
      // rather than one undifferentiated run.
      ctx.globalAlpha = 0.5;
      for (let i = 1; i < placed.length; i++) {
        if (placed[i].system === placed[i - 1].system) continue;
        const x = (placed[i].x + placed[i - 1].x) / 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const p of placed) {
        const y = h - ((p.midi - lo) / span) * h;
        const on = p.id === selected;
        ctx.fillStyle = on ? `rgb(${css('--pink')})` : `rgb(${css(inks[p.staffRow % inks.length])})`;
        ctx.globalAlpha = on ? 1 : 0.75;
        const r = on ? 3.6 : 2.4;
        ctx.beginPath();
        ctx.ellipse(p.x, y, r * 1.3, r, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Which page this is describing, bottom right, on its own ground so the
      // dots behind it cannot eat the number.
      const label = `PAGE ${visiblePage + 1}`;
      const lw = ctx.measureText(label).width;
      ctx.fillStyle = `rgb(${css('--sunk')})`;
      ctx.fillRect(w - lw - 8, h - 13, lw + 8, 13);
      ctx.fillStyle = `rgb(${css('--ink-3')})`;
      ctx.fillText(label, w - lw - 4, h - 4);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [score, selected, visiblePage]);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!score) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const placed = layout(score, rect.width, visiblePage);
    if (!placed.length) return;
    const pitches = placed.map((p) => p.midi);
    const lo = Math.min(...pitches) - 2;
    const hi = Math.max(...pitches) + 2;
    const span = Math.max(6, hi - lo);
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    let best: (typeof placed)[number] | null = null;
    let bestD = Infinity;
    for (const p of placed) {
      const y = rect.height - ((p.midi - lo) / span) * rect.height;
      const d = Math.hypot(p.x - px, y - py);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    if (best && bestD < 22) {
      const note = score.notes.find((n) => n.id === best!.id);
      if (note) {
        select(note.id);
        soundNote(note);
      }
    }
  };

  if (!score) return null;
  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onDown}
      className="w-full cursor-pointer touch-none"
      style={{ height }}
      aria-label={`Piano roll — the notes on page ${visiblePage + 1} by pitch and position`}
    />
  );
}

/** Place one page's notes along the width, in reading order. */
function layout(score: PageScore, width: number, page: number) {
  const staffOf = new Map(score.staves.map((s) => [s.id, s]));
  const rowOf = new Map(score.staves.map((s) => [s.id, s.positionInSystem]));

  const items = score.notes
    .filter((n) => n.page === page)
    .map((n) => {
      const staff = staffOf.get(n.staff);
      if (!staff) return null;
      return {
        id: n.id,
        midi: noteMidi(n, staff, score),
        system: staff.system,
        x: n.x,
        staffRow: rowOf.get(n.staff) ?? 0,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v != null)
    .sort((a, b) => a.system - b.system || a.x - b.x);

  // Spread by reading order, so a busy page still fits the width.
  return items.map((item, i) => ({
    ...item,
    x: items.length > 1 ? 6 + (i / (items.length - 1)) * (width - 12) : width / 2,
  }));
}
