import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store';
import {
  CLEFS,
  KEYS,
  keyShort,
  noteAlter,
  noteName,
  notePrinted,
  staffSharps,
  stepAt,
  stepToMidi,
  stepToName,
  type Alter,
  type ClefId,
  type DetectedNote,
  type DetectedStaff,
  type PageScore,
} from '../lib/detect/types';

/** What a point on the page resolves to: a notehead, or a place on a staff. */
interface Aim {
  page: number;
  staff: string;
  /** The notehead this would play, if it is one. */
  note: string | null;
  x: number;
  y: number;
  /** Staff spacing, so the marker is drawn to the size of the music. */
  radius: number;
  label: string;
}

/**
 * The dots over the noteheads.
 *
 * Held apart from the rest of the page because the aiming marker follows the
 * pointer, and without this every mouse move would re-diff a thousand of these.
 */
const Dots = memo(function Dots({
  notes,
  staves,
  score,
  selected,
}: {
  notes: DetectedNote[];
  staves: DetectedStaff[];
  score: PageScore;
  selected: string | null;
}) {
  return (
    <>
      {notes.map((n) => {
        const staff = staves.find((s) => s.id === n.staff);
        if (!staff) return null;
        const on = selected === n.id;
        const edited = (score.nudges[n.id] ?? 0) !== 0 || n.id in (score.alters ?? {});
        return (
          <ellipse
            key={n.id}
            cx={n.x}
            cy={n.y}
            rx={staff.spacing * 0.78}
            ry={staff.spacing * 0.6}
            fill={on ? 'rgb(var(--pink))' : edited ? 'rgb(var(--gold))' : 'rgb(var(--blue))'}
            opacity={on ? 0.5 : edited ? 0.36 : 0.16}
          />
        );
      })}
    </>
  );
});

/**
 * Your sheet music, made audible.
 *
 * The page is the one you imported, drawn exactly as printed — nothing is
 * re-engraved, so nothing can come out looking like different music. On top of
 * it sits a transparent layer that knows where the staves and noteheads are.
 *
 * Tap a notehead and you hear it. And because pitch is just geometry once the
 * staff lines are known, tapping *anywhere* on a staff sounds the pitch at that
 * height — so a notehead the detector missed is still playable, by pointing at
 * it.
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
  const setAlter = useApp((s) => s.setAlter);
  const nudgeSelected = useApp((s) => s.nudgeSelected);

  const setVisiblePage = useApp((s) => s.setVisiblePage);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const viewport = useRef<HTMLDivElement | null>(null);
  /** Width of the scrollport, so a page can be sized in real pixels. */
  const [avail, setAvail] = useState(0);
  /**
   * What the pointer is on, or what the last tap landed on. Drawn on the page
   * so that aiming is something you can see rather than something you find out
   * about by hearing the wrong note.
   */
  const [aim, setAim] = useState<Aim | null>(null);
  const aimTimer = useRef<number | undefined>(undefined);
  /** The pitch that last sounded, named — the app's answer, for you to check. */
  const [heard, setHeard] = useState<{ note: string | null; label: string } | null>(null);
  /** The last clef change, so it can be narrowed back to a single staff. */
  const [clefEdit, setClefEdit] = useState<{
    staffId: string;
    clef: ClefId;
    count: number;
    prev: Record<string, ClefId>;
  } | null>(null);

  /** A mouse press, which sounds as it moves. Touch never gets here. */
  const dragging = useRef(false);
  const lastSounded = useRef<string | null>(null);
  /**
   * A finger on the page. Nothing sounds until it lifts, because until then
   * there is no telling a tap from the start of a scroll — and sounding on the
   * way past is how a page turn ends up playing four notes you did not want.
   */
  const tap = useRef<{ id: number; x: number; y: number; at: number; moved: boolean } | null>(null);

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

  // Arrow keys still correct a note's line, for anyone with a keyboard.
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
        setHeard(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nudgeSelected, select]);

  // How much room there is to draw a page in.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setAvail(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  /** Leave the marker up long enough to read after a tap, then clear it. */
  const holdAim = () => {
    window.clearTimeout(aimTimer.current);
    aimTimer.current = window.setTimeout(() => setAim(null), 1800);
  };
  const clearAim = () => {
    window.clearTimeout(aimTimer.current);
    setAim(null);
  };

  /**
   * How wide to draw a page. At zoom 1 it fills the screen, and above that it
   * overflows and pans — which is the only way zooming means anything on a
   * phone, where the page already reaches both edges.
   */
  const GUTTER = 26;
  const fit = Math.max(240, Math.min((avail || 960) - 24, 1126) - GUTTER);
  const pageWidth = Math.round(fit * zoom);

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

  /**
   * What a point on the page means, before anything is played.
   *
   * Height decides the pitch, so height decides which note: anywhere within a
   * notehead's own line or space *is* that notehead, and a tap half a space
   * high is a different pitch rather than a near miss. Sideways the target is
   * much wider, because the next note along is further away than a fingertip is
   * wide and there is nothing else the tap could have meant.
   *
   * Falling through to bare staff still works where a notehead was missed, but
   * it is now what happens when there is genuinely nothing there, rather than
   * what happens whenever a tap lands a couple of millimetres off.
   */
  const aimAt = (page: number, imgX: number, imgY: number): Aim | null => {
    const staff = staffAt(page, imgY);
    if (!staff) return null;
    const sp = staff.spacing;

    let best: DetectedNote | null = null;
    let bestScore = Infinity;
    for (const n of notesByPage.get(page) ?? []) {
      if (n.staff !== staff.id) continue;
      const dy = Math.abs(n.y - imgY);
      const dx = Math.abs(n.x - imgX);
      if (dy > sp * 0.5 || dx > sp * 2.2) continue;
      // Height first, and by a long way: sideways only breaks the tie between
      // two notes that are equally on the line you tapped.
      const score = dy * 4 + dx;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }

    if (best) {
      return {
        page,
        staff: staff.id,
        note: best.id,
        x: best.x,
        y: best.y,
        radius: sp,
        label: noteName(best, staff, score),
      };
    }

    // Nothing there. The marker sits on the exact line or space that will
    // sound, not where the finger landed, so a miss is visible as a miss.
    const step = stepAt(staff, imgY);
    return {
      page,
      staff: staff.id,
      note: null,
      x: imgX,
      y: staff.lines[4] - step * (sp / 2),
      radius: sp,
      label: stepToName(step, staff.clef, staffSharps(staff, score)),
    };
  };

  /** Show what a point would play, without playing it. */
  const showAim = (next: Aim | null) => {
    setAim((prev) => {
      const same =
        prev?.page === next?.page &&
        prev?.note === next?.note &&
        prev?.y === next?.y &&
        (next?.note != null || prev?.x === next?.x);
      return same ? prev : next;
    });
  };

  const handlePoint = (page: number, imgX: number, imgY: number, isDrag: boolean) => {
    const target = aimAt(page, imgX, imgY);
    if (!target) return;
    const staff = score.staves.find((s) => s.id === target.staff);
    if (!staff) return;

    const key = target.note ?? `${target.staff}:${target.y}`;
    if (isDrag && lastSounded.current === key) return;
    lastSounded.current = key;
    showAim(target);
    holdAim();

    const note = target.note ? score.notes.find((n) => n.id === target.note) : null;
    if (note) {
      select(note.id);
      setHeard({ note: note.id, label: noteName(note, staff, score) });
      soundNote(note);
      return;
    }

    const step = stepAt(staff, target.y);
    select(null);
    setHeard({ note: null, label: target.label });
    sound(stepToMidi(step, staff.clef, staffSharps(staff, score)));
  };

  const heardNote = heard?.note ? score.notes.find((n) => n.id === heard.note) : null;
  const heardStaff = heardNote ? score.staves.find((s) => s.id === heardNote.staff) : null;
  // What is printed *on* this note is what the buttons set. What is in force is
  // what you hear, and the two differ whenever a bar carries an accidental from
  // an earlier note — which is most of the time, in most music.
  const heardPrinted = heardNote ? notePrinted(heardNote, score) : null;
  const carried = heardNote && heardPrinted === null && noteAlter(heardNote, score) !== null;
  // Read from the score rather than remembered, so correcting a note renames it
  // rather than leaving the old answer sitting there.
  const heardLabel =
    heardNote && heardStaff ? noteName(heardNote, heardStaff, score) : (heard?.label ?? '');

  return (
    <div ref={viewport} className="w-full">
      {/* As wide as the widest page, and never narrower than the screen: that
          is what lets a zoomed page pan sideways instead of being clipped. */}
      <div className="flex w-max min-w-full flex-col items-center gap-6 p-3 pb-10">
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
              className="relative pl-[26px]"
              style={{ width: `${pageWidth + GUTTER}px` }}
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
                  /* The browser keeps scrolling and pinching. Taking those over
                     to listen for drags is what made the page feel sticky and
                     fired notes at every attempt to scroll past them. */
                  className="absolute inset-0 h-full w-full [touch-action:manipulation]"
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse') {
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
                      return;
                    }
                    tap.current = {
                      id: e.pointerId,
                      x: e.clientX,
                      y: e.clientY,
                      at: Date.now(),
                      moved: false,
                    };
                    // Show what this touch would play, without playing it. The
                    // note sounds on release, so there is a moment in between to
                    // see whether the finger landed where it was aimed.
                    const r = e.currentTarget.getBoundingClientRect();
                    window.clearTimeout(aimTimer.current);
                    showAim(
                      aimAt(
                        page.index,
                        ((e.clientX - r.left) / r.width) * page.width,
                        ((e.clientY - r.top) / r.height) * page.height,
                      ),
                    );
                  }}
                  onPointerMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const ix = ((e.clientX - r.left) / r.width) * page.width;
                    const iy = ((e.clientY - r.top) / r.height) * page.height;
                    if (e.pointerType !== 'mouse') {
                      const t = tap.current;
                      if (!t || t.id !== e.pointerId) return;
                      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 9) {
                        // The finger is travelling: this is a scroll, not a tap.
                        t.moved = true;
                        clearAim();
                      } else showAim(aimAt(page.index, ix, iy));
                      return;
                    }
                    if (dragging.current) handlePoint(page.index, ix, iy, true);
                    else showAim(aimAt(page.index, ix, iy));
                  }}
                  onPointerUp={(e) => {
                    if (e.pointerType === 'mouse') {
                      dragging.current = false;
                      lastSounded.current = null;
                      return;
                    }
                    // A tap: barely moved, and let go rather than held.
                    const t = tap.current;
                    tap.current = null;
                    if (!t || t.id !== e.pointerId || t.moved || Date.now() - t.at > 700) {
                      clearAim();
                      return;
                    }
                    const r = e.currentTarget.getBoundingClientRect();
                    lastSounded.current = null;
                    handlePoint(
                      page.index,
                      ((e.clientX - r.left) / r.width) * page.width,
                      ((e.clientY - r.top) / r.height) * page.height,
                      false,
                    );
                  }}
                  /* The browser fires this the moment it decides the gesture is
                     a scroll, which is precisely when the note should not play. */
                  onPointerCancel={() => {
                    tap.current = null;
                    dragging.current = false;
                    clearAim();
                  }}
                  /* A touch pointer stops existing the moment it lifts, so the
                     browser fires leave straight after up. Clearing the marker
                     there would wipe it in the same frame it was earned. */
                  onPointerLeave={(e) => {
                    dragging.current = false;
                    if (e.pointerType === 'mouse') clearAim();
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

                  {showNotes && (
                    <Dots notes={notes} staves={staves} score={score} selected={selected} />
                  )}

                  {/* Where a tap would land, and what it would sound. On a
                      notehead it is a ring around that head; on bare staff it is
                      a ghost sitting on the exact line or space that will play,
                      which is the difference between missing and knowing you
                      missed. The shapes scale with the music, because they have
                      to line up with it; their strokes do not, because a marker
                      drawn a fifth of a pixel wide marks nothing. */}
                  {aim && aim.page === page.index && (
                    <g
                      data-aim={aim.note ? 'note' : 'staff'}
                      className="pointer-events-none"
                      stroke="rgb(var(--pink))"
                      fill="none"
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    >
                      {aim.note ? (
                        <ellipse
                          cx={aim.x}
                          cy={aim.y}
                          rx={aim.radius * 1.05}
                          ry={aim.radius * 0.82}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : (
                        <>
                          <line
                            x1={aim.x - aim.radius * 1.7}
                            x2={aim.x + aim.radius * 1.7}
                            y1={aim.y}
                            y2={aim.y}
                            vectorEffect="non-scaling-stroke"
                          />
                          <ellipse
                            cx={aim.x}
                            cy={aim.y}
                            rx={aim.radius * 0.62}
                            ry={aim.radius * 0.46}
                            vectorEffect="non-scaling-stroke"
                          />
                        </>
                      )}
                    </g>
                  )}
                </svg>

                {/* The name, at a size you can read whatever the zoom. */}
                {aim && aim.page === page.index && (
                  <div
                    className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm px-1.5 py-0.5 font-display text-[12px] font-bold leading-tight"
                    style={{
                      left: `${(aim.x / page.width) * 100}%`,
                      top: `${((aim.y - aim.radius * 1.3) / page.height) * 100}%`,
                      background: 'rgb(var(--pink))',
                      color: '#fff',
                    }}
                  >
                    {aim.label}
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
      </div>

      {/* A score's layout repeats, so setting a clef sets it on every system —
          which turns 23 taps into one. Saying so, with a way back, beats both
          asking first and doing it silently. */}
      {clefEdit && (
        <div className="sticky bottom-2 z-20 mx-auto flex w-fit max-w-[calc(100%-24px)] flex-wrap items-center gap-2 border-[1.5px] border-ink bg-panel px-3 py-2 shadow-stamp">
          <span className="lbl">
            {CLEFS.find((c) => c.id === clefEdit.clef)?.label} set on {clefEdit.count} staves
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => {
              applyClefs({ ...clefEdit.prev, [clefEdit.staffId]: clefEdit.clef });
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

      {/* What you just heard, named. This is the only way to tell whether the
          app agrees with the page in front of you, so it is a readout first —
          and the accidental buttons say what is *printed*, which is something
          you can read off the page, rather than asking you to work out which
          way the pitch should move. */}
      {heard && (
        <div className="sticky bottom-2 z-20 mx-auto flex w-fit max-w-[calc(100%-24px)] items-center gap-2 border-[1.5px] border-ink bg-panel px-3 py-2 shadow-stamp">
          <span className="lbl hidden sm:inline">Heard</span>
          <span className="font-display text-[17px] font-bold leading-none">{heardLabel}</span>
          {heardNote ? (
            <>
              <span className="lbl ml-1">Printed</span>
              <div className="flex gap-1">
                {(
                  [
                    [-1, '♭'],
                    [0, '♮'],
                    [1, '♯'],
                  ] as Array<[Alter, string]>
                ).map(([value, mark]) => (
                  <button
                    key={mark}
                    className={`btn px-2.5 ${heardPrinted === value ? 'btn-on' : ''}`}
                    title={
                      heardPrinted === value
                        ? 'Tap again if nothing is printed on this note'
                        : `There is a ${mark} printed beside this note on the page`
                    }
                    onClick={() => setAlter(heardNote.id, heardPrinted === value ? null : value)}
                  >
                    {mark}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <span className="lbl hidden sm:inline">from the staff line</span>
          )}
          {carried && (
            <span
              className="lbl hidden sm:inline"
              title="An accidental earlier in this bar is still in force on this line. It lasts until the barline."
            >
              held from earlier in the bar
            </span>
          )}
          <button
            className="btn btn-ghost ml-1"
            onClick={() => {
              setHeard(null);
              select(null);
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
