import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../lib/audio/engine';
import { inkVar, type PlayNote } from '../../lib/score/types';
import { heatOf } from '../../lib/db/db';

/**
 * The engraved score, with the sounding note lit.
 *
 * The important detail: this component never *drives* anything. Every frame it
 * asks the audio engine where it is and paints that. Highlighting therefore
 * cannot drift from the sound, because it is a view of the sound.
 */
export default function ScoreView() {
  const svg = useApp((s) => s.svg);
  const score = useApp((s) => s.score);
  const mixes = useApp((s) => s.mixes);
  const bars = useApp((s) => s.bars);
  const stepMode = useApp((s) => s.stepMode);
  const loopBars = useApp((s) => s.loopBars);
  const seekQ = useApp((s) => s.seekQ);
  const setLoopBars = useApp((s) => s.setLoopBars);

  const hostRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<Set<string>>(new Set());
  const dragFrom = useRef<number | null>(null);

  /** id → note, for click-to-seek and for painting. */
  const byId = useMemo(() => {
    const m = new Map<string, PlayNote>();
    for (const n of score?.notes ?? []) m.set(n.id, n);
    return m;
  }, [score]);

  /** Notes grouped by onset so a chord lights as one. */
  const timeline = useMemo(() => {
    const list = (score?.notes ?? []).slice().sort((a, b) => a.q - b.q);
    return list;
  }, [score]);

  // --- paint the SVG ------------------------------------------------------
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = svg;
    activeRef.current = new Set();

    // Give every part's notes their ink, so highlighting matches the mixer.
    if (score) {
      for (const measure of Array.from(host.querySelectorAll('g.measure'))) {
        const staves = Array.from(measure.querySelectorAll('g.staff'));
        staves.forEach((staff, i) => {
          (staff as HTMLElement).style.setProperty('--cn-ink', inkVar(i));
          staff.setAttribute('data-part', String(i));
        });
      }
    }
  }, [svg, score]);

  // --- muted parts fade back ----------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const anySolo = mixes.some((m) => m.solo);
    for (const staff of Array.from(host.querySelectorAll('g.staff'))) {
      const part = Number(staff.getAttribute('data-part') ?? -1);
      const mix = mixes[part];
      const audible = !mix ? true : anySolo ? mix.solo : !mix.muted;
      staff.classList.toggle('cn-muted', !audible);
    }
  }, [mixes, svg]);

  // --- trouble-map wash behind bars ---------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !score) return;
    for (const el of Array.from(host.querySelectorAll('.cn-measure-heat'))) el.remove();
    if (!bars.size) return;

    const measures = Array.from(host.querySelectorAll('g.measure'));
    measures.forEach((measure, i) => {
      const stat = bars.get(i + 1);
      const heat = heatOf(stat);
      if (heat === 'untouched' || heat === 'clean') return;
      const box = (measure as SVGGraphicsElement).getBBox?.();
      if (!box) return;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'cn-measure-heat');
      rect.setAttribute('x', String(box.x));
      rect.setAttribute('y', String(box.y));
      rect.setAttribute('width', String(box.width));
      rect.setAttribute('height', String(box.height));
      rect.setAttribute('fill', heat === 'trouble' ? 'rgb(var(--crit))' : 'rgb(var(--warn))');
      rect.setAttribute('opacity', heat === 'trouble' ? '0.13' : '0.09');
      measure.insertBefore(rect, measure.firstChild);
    });
  }, [bars, svg, score]);

  // --- loop region wash ----------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    for (const el of Array.from(host.querySelectorAll('.cn-loop-wash'))) el.remove();
    if (!loopBars) return;
    const measures = Array.from(host.querySelectorAll('g.measure'));
    for (let i = loopBars[0] - 1; i <= loopBars[1] - 1 && i < measures.length; i++) {
      const measure = measures[i];
      if (!measure) continue;
      const box = (measure as SVGGraphicsElement).getBBox?.();
      if (!box) continue;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'cn-loop-wash');
      rect.setAttribute('x', String(box.x));
      rect.setAttribute('y', String(box.y - 40));
      rect.setAttribute('width', String(box.width));
      rect.setAttribute('height', String(box.height + 80));
      rect.setAttribute('fill', 'rgb(var(--blue))');
      rect.setAttribute('opacity', '0.09');
      measure.insertBefore(rect, measure.firstChild);
    }
  }, [loopBars, svg]);

  // --- the frame loop ------------------------------------------------------
  useEffect(() => {
    if (!score) return;
    let raf = 0;
    let lastScrollQ = -1;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const host = hostRef.current;
      if (!host) return;

      const state = engine.getState();
      const q = state.q;
      const next = new Set<string>();

      // Notes sounding right now. Linear scan is fine: even a symphony
      // movement is a few thousand notes, and this runs at most 60×/second.
      for (const n of timeline) {
        if (n.q > q) break;
        if (q < n.q + n.qDur) next.add(n.id);
      }
      // In step mode the parked note stays lit even though nothing is playing.
      if (stepMode) {
        for (const n of timeline) {
          if (Math.abs(n.q - q) < 1e-4) next.add(n.id);
        }
      }

      const prev = activeRef.current;
      if (next.size !== prev.size || Array.from(next).some((id) => !prev.has(id))) {
        for (const id of prev) {
          if (!next.has(id)) host.querySelector(`#${CSS.escape(id)}`)?.classList.remove('cn-on', 'cn-step');
        }
        for (const id of next) {
          if (!prev.has(id)) {
            host.querySelector(`#${CSS.escape(id)}`)?.classList.add(stepMode ? 'cn-step' : 'cn-on');
          }
        }
        activeRef.current = next;
      }

      // Cursor: sits on the leftmost sounding note.
      const cursor = cursorRef.current;
      if (cursor) {
        let anchorEl: Element | null = null;
        for (const id of next) {
          const el = host.querySelector(`#${CSS.escape(id)}`);
          if (!el) continue;
          if (!anchorEl) anchorEl = el;
        }
        if (anchorEl && (state.playing || stepMode)) {
          const hostBox = host.getBoundingClientRect();
          const box = anchorEl.getBoundingClientRect();
          cursor.style.opacity = '1';
          cursor.style.transform = `translate(${box.left - hostBox.left + host.scrollLeft + box.width / 2 - 1}px, ${
            box.top - hostBox.top + host.scrollTop - 26
          }px)`;
          cursor.style.height = `${box.height + 52}px`;

          // Keep the playhead on screen without fighting the user's scrolling.
          if (state.playing && Math.abs(q - lastScrollQ) > 0.4) {
            lastScrollQ = q;
            const scroller = host.parentElement;
            if (scroller) {
              const rel = box.top - scroller.getBoundingClientRect().top;
              if (rel < 60 || rel > scroller.clientHeight - 110) {
                scroller.scrollBy({ top: rel - 120, behavior: 'smooth' });
              }
            }
          }
        } else {
          cursor.style.opacity = '0';
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [score, timeline, stepMode]);

  // --- click a note to jump there; drag across bars to set a loop ----------
  const measureAt = (target: EventTarget | null): number | null => {
    const el = (target as Element)?.closest?.('g.measure');
    if (!el || !hostRef.current) return null;
    const all = Array.from(hostRef.current.querySelectorAll('g.measure'));
    const idx = all.indexOf(el);
    return idx >= 0 ? idx + 1 : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const noteEl = (e.target as Element).closest?.('g.note');
    if (noteEl) {
      const note = byId.get(noteEl.id);
      if (note) {
        seekQ(note.q);
        void engine.preview(note.midi, note.part, 0.5, note.syllable);
      }
    }
    dragFrom.current = measureAt(e.target);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    const to = measureAt(e.target);
    dragFrom.current = null;
    if (from != null && to != null && from !== to) {
      setLoopBars([Math.min(from, to), Math.max(from, to)]);
    }
  };

  if (!score) return null;

  return (
    <div className="relative h-full overflow-auto bg-panel">
      <div
        ref={hostRef}
        className="score-host relative p-4"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />
      <div
        ref={cursorRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 w-[2px] opacity-0"
        style={{ background: 'rgb(var(--pink))', boxShadow: '0 0 12px rgb(var(--pink))' }}
      />
    </div>
  );
}
