import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store';
import {
  CLEFS,
  KEYS,
  keyShort,
  noteName,
  staffSharps,
  stepAt,
  stepToMidi,
  stepToName,
  type ClefId,
  type DetectedNote,
  type DetectedStaff,
} from '../lib/detect/types';

/**
 * Your sheet music, made audible.
 *
 * The page is the one you imported, drawn exactly as printed — nothing is
 * re-engraved, so nothing can come out looking like different music. On top of
 * it sits a transparent layer that knows where the staves and noteheads are.
 *
 * Click a notehead and you hear it. Drag across a phrase and you hear the
 * phrase. And because pitch is just geometry once the staff lines are known,
 * clicking *anywhere* on a staff sounds the pitch at that height — so a
 * notehead the detector missed is still playable, by pointing at it.
 */
export default function Sheet() {
  const score = useApp((s) => s.score);
  const zoom = useApp((s) => s.zoom);
  const showNotes = useApp((s) => s.showNotes);
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);
  const sound = useApp((s) => s.sound);
  const soundNote = useApp((s) => s.soundNote);
  const setStaffClef = useApp((s) => s.setStaffClef);
  const applyClefs = useApp((s) => s.applyClefs);
  const setStaffSharps = useApp((s) => s.setStaffSharps);
  const nudgeSelected = useApp((s) => s.nudgeSelected);

  const setVisiblePage = useApp((s) => s.setVisiblePage);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dragging = useRef(false);
  const lastSounded = useRef<string | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    label: string;
  } | null>(null);
  /** The last clef change, so it can be narrowed back to a single staff. */
  const [clefEdit, setClefEdit] = useState<{
    staffId: string;
    clef: ClefId;
    count: number;
    prev: Record<string, ClefId>;
  } | null>(null);

  const stavesByPage = useMemo(() => {
    const map = new Map<number, DetectedStaff[]>();
    for (const s of score?.staves ?? []) {
      if (!map.has(s.page)) map.set(s.page, []);
      map.get(s.page)!.push(s);
    }
    return map;
  }, [score]);

  const notesByPage = useMemo(() => {
    const map = new Map<number, DetectedNote[]>();
    for (const n of score?.notes ?? []) {
      if (!map.has(n.page)) map.set(n.page, []);
      map.get(n.page)!.push(n);
    }
    return map;
  }, [score]);

  // Arrow keys correct the selected note; that is the whole editing model.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!useApp.getState().selected) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        nudgeSelected(e.shiftKey ? 7 : 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        nudgeSelected(e.shiftKey ? -7 : -1);
      } else if (e.key === 'Escape') {
        select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nudgeSelected, select]);

  // The piano roll follows whichever page you are looking at.
  useEffect(() => {
    const nodes = pageRefs.current.filter(Boolean) as HTMLDivElement[];
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let bestRatio = 0;
        let bestPage = -1;
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.page);
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            bestPage = idx;
          }
        }
        if (bestPage >= 0) setVisiblePage(bestPage);
      },
      { threshold: [0.1, 0.3, 0.6, 0.9] },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [score?.id, setVisiblePage]);

  if (!score) return null;

  /** Which staff a point falls on — the nearest one within reach. */
  const staffAt = (page: number, y: number): DetectedStaff | null => {
    const staves = stavesByPage.get(page) ?? [];
    let best: DetectedStaff | null = null;
    let bestDistance = Infinity;
    for (const s of staves) {
      const reach = s.spacing * 3.2;
      const distance = y < s.top ? s.top - y : y > s.bottom ? y - s.bottom : 0;
      if (distance <= reach && distance < bestDistance) {
        best = s;
        bestDistance = distance;
      }
    }
    return best;
  };

  const handlePoint = (page: number, imgX: number, imgY: number, isDrag: boolean) => {
    const notes = notesByPage.get(page) ?? [];
    const staff = staffAt(page, imgY);
    if (!staff) return;

    // Snap to a notehead when the pointer is near one.
    let nearest: (typeof notes)[number] | null = null;
    let bestDistance = Infinity;
    for (const n of notes) {
      if (n.staff !== staff.id) continue;
      const dx = n.x - imgX;
      const dy = n.y - imgY;
      const d = Math.hypot(dx, dy * 0.8);
      if (d < staff.spacing * 1.3 && d < bestDistance) {
        nearest = n;
        bestDistance = d;
      }
    }

    if (nearest) {
      if (isDrag && lastSounded.current === nearest.id) return;
      lastSounded.current = nearest.id;
      select(nearest.id);
      soundNote(nearest);
      return;
    }

    // No notehead here — sound the pitch at this height anyway. This is what
    // keeps the app usable where detection missed something.
    const step = stepAt(staff, imgY);
    const key = `${staff.id}:${step}`;
    if (isDrag && lastSounded.current === key) return;
    lastSounded.current = key;
    select(null);
    sound(stepToMidi(step, staff.clef, score.sharps));
  };

  return (
    <div className="flex flex-col items-center gap-6 p-3 pb-10">
      {score.pages.map((page) => {
        const staves = stavesByPage.get(page.index) ?? [];
        const notes = notesByPage.get(page.index) ?? [];
        return (
          <div
            key={page.index}
            data-page={page.index}
            ref={(el) => {
              pageRefs.current[page.index] = el;
            }}
            className="relative w-full pl-[26px]"
            style={{ maxWidth: `${Math.round(1126 * zoom)}px` }}
          >
            {/* The page itself is inset, leaving a gutter for the clef pickers.
                On a phone there is no page margin to put them in, and a control
                sitting on top of the music is a control in the way. */}
            <div className="relative">
              <img
                src={page.image}
                alt={`Page ${page.index + 1}`}
                className="block w-full select-none border border-rule2 bg-white shadow-stamp"
                draggable={false}
              />

              <svg
                viewBox={`0 0 ${page.width} ${page.height}`}
                className="absolute inset-0 h-full w-full touch-none"
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  dragging.current = true;
                  lastSounded.current = null;
                  const r = e.currentTarget.getBoundingClientRect();
                  handlePoint(
                    page.index,
                    ((e.clientX - r.left) / r.width) * page.width,
                    ((e.clientY - r.top) / r.height) * page.height,
                    false,
                  );
                }}
                onPointerMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const ix = ((e.clientX - r.left) / r.width) * page.width;
                  const iy = ((e.clientY - r.top) / r.height) * page.height;
                  if (dragging.current) handlePoint(page.index, ix, iy, true);
                  else {
                    const staff = staffAt(page.index, iy);
                    setHover(
                      staff
                        ? {
                            x: e.clientX - r.left,
                            y: e.clientY - r.top,
                            label: stepToName(stepAt(staff, iy), staff.clef, score.sharps),
                          }
                        : null,
                    );
                  }
                }}
                onPointerUp={() => {
                  dragging.current = false;
                  lastSounded.current = null;
                }}
                onPointerLeave={() => {
                  dragging.current = false;
                  setHover(null);
                }}
              >
                {/* A faint band per staff, so it is obvious the page is live. */}
                {staves.map((s) => (
                  <rect
                    key={s.id}
                    x={s.left}
                    y={s.top - s.spacing * 2.6}
                    width={Math.max(0, s.right - s.left)}
                    height={s.bottom - s.top + s.spacing * 5.2}
                    fill="rgb(var(--blue))"
                    opacity={0.045}
                  />
                ))}

                {showNotes &&
                  notes.map((n) => {
                    const staff = staves.find((s) => s.id === n.staff);
                    if (!staff) return null;
                    const on = selected === n.id;
                    const moved = (score.nudges[n.id] ?? 0) !== 0;
                    return (
                      <ellipse
                        key={n.id}
                        cx={n.x}
                        cy={n.y}
                        rx={staff.spacing * 0.78}
                        ry={staff.spacing * 0.6}
                        fill={
                          on ? 'rgb(var(--pink))' : moved ? 'rgb(var(--gold))' : 'rgb(var(--blue))'
                        }
                        opacity={on ? 0.5 : moved ? 0.36 : 0.16}
                      />
                    );
                  })}
              </svg>

              {hover && (
                <div
                  className="pointer-events-none absolute z-10 rounded-sm px-1.5 py-0.5 font-mono text-[11px]"
                  style={{
                    left: hover.x + 12,
                    top: hover.y - 10,
                    background: 'rgb(var(--ink))',
                    color: 'rgb(var(--paper))',
                  }}
                >
                  {hover.label}
                </div>
              )}
            </div>

            {/* Clef per staff. Recognition cannot see the small 8 under a tenor
                clef, and the wrong clef puts a whole staff in the wrong octave,
                so it is one tap to set and it sits in the gutter beside it. */}
            {staves.map((s) => (
              <span
                key={`clef-${s.id}`}
                className="clef-pick absolute"
                style={{
                  left: 0,
                  top: `${((s.top - s.spacing * 0.5) / page.height) * 100}%`,
                }}
                title="Which clef this staff is in — the wrong one puts the whole staff in the wrong octave. Applies to the same staff on every system."
              >
                {CLEFS.find((c) => c.id === s.clef)?.short}
                <select
                  value={s.clef}
                  onChange={(e) => {
                    const clef = e.target.value as ClefId;
                    const prev = Object.fromEntries(score.staves.map((x) => [x.id, x.clef]));
                    const count = setStaffClef(s.id, clef);
                    setClefEdit(count > 1 ? { staffId: s.id, clef, count, prev } : null);
                  }}
                  aria-label={`Clef for staff ${s.positionInSystem + 1} of system ${s.system + 1}`}
                >
                  {CLEFS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.short} · {c.label}
                    </option>
                  ))}
                </select>
              </span>
            ))}

            {/* Key per staff, under the clef. Music changes key, and this score
                does: one setting for the whole piece would be wrong for every
                note after the change. What was read here is shown, so you can
                see at a glance whether it agrees with the page. */}
            {staves.map((s) => (
              <span
                key={`key-${s.id}`}
                className="clef-pick absolute"
                style={{
                  left: 0,
                  top: `calc(${((s.top - s.spacing * 0.5) / page.height) * 100}% + 17px)`,
                }}
                title="The key signature in force on this staff — change it if it does not match what is printed"
              >
                {keyShort(staffSharps(s, score))}
                <select
                  value={staffSharps(s, score)}
                  onChange={(e) => setStaffSharps(s.id, Number(e.target.value))}
                  aria-label={`Key for staff ${s.positionInSystem + 1} of system ${s.system + 1}`}
                >
                  {KEYS.map((k) => (
                    <option key={k.sharps} value={k.sharps}>
                      {k.short} · {k.label}
                    </option>
                  ))}
                </select>
              </span>
            ))}

            <div className="lbl mt-1 text-center">Page {page.index + 1}</div>
          </div>
        );
      })}

      {/* A score's layout repeats, so setting a clef sets it on every system —
          which turns 23 taps into one. Saying so, with a way back, beats both
          asking first and doing it silently. */}
      {clefEdit && (
        <div className="sticky bottom-2 z-20 flex flex-wrap items-center gap-2 border-[1.5px] border-ink bg-panel px-3 py-2 shadow-stamp">
          <span className="lbl">
            {CLEFS.find((c) => c.id === clefEdit.clef)?.label} set on {clefEdit.count} staves
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => {
              applyClefs({
                ...clefEdit.prev,
                [clefEdit.staffId]: clefEdit.clef,
              });
              setClefEdit(null);
            }}
          >
            Only this staff
          </button>
          <button className="btn" onClick={() => setClefEdit(null)}>
            OK
          </button>
        </div>
      )}

      {selected && (
        <div className="sticky bottom-2 z-20 flex items-center gap-2 border-[1.5px] border-ink bg-panel px-3 py-2 shadow-stamp">
          <span className="lbl">Selected</span>
          <span className="font-display text-[15px] font-bold">
            {(() => {
              const n = score.notes.find((x) => x.id === selected);
              const s = n && score.staves.find((y) => y.id === n.staff);
              return n && s ? noteName(n, s, score) : '—';
            })()}
          </span>
          <button className="btn" onClick={() => nudgeSelected(1)} title="Up one step (↑)">
            ↑
          </button>
          <button className="btn" onClick={() => nudgeSelected(-1)} title="Down one step (↓)">
            ↓
          </button>
          <span className="lbl hidden sm:inline">arrow keys · shift for an octave</span>
          <button className="btn btn-ghost" onClick={() => select(null)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
