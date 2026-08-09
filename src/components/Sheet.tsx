import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store';
import {
  CLEFS,
  KEYS,
  keyShort,
  noteAlter,
  noteName,
  notePrinted,
  partInk,
  partShort,
  scoreParts,
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
  /**
   * A notehead that is right here but belongs to another part, while a part is
   * soloed. It is drawn and named anyway: a tap that does nothing is alarming,
   * and a tap that says "that one is the Alto" is an answer.
   */
  muted?: { name: string; ink: string };
}

/**
 * The veil that puts the rest of the score behind glass.
 *
 * Fading the other parts cannot be done by drawing over their noteheads,
 * because the page is a photograph of printed ink and the other parts are
 * *inside* it — along with their stems, their words and their beams. So the
 * whole page is washed out and the current part's notes are punched back
 * through it at full contrast. The staff lines stay faintly visible, because a
 * line of music with no staff under it is not readable, only isolated.
 *
 * Held apart and memoised for the same reason the dots are: the aiming marker
 * follows the pointer, and this must not be rebuilt on every move.
 */
const Veil = memo(function Veil({
  id,
  width,
  height,
  notes,
  staves,
}: {
  id: string;
  width: number;
  height: number;
  notes: DetectedNote[];
  staves: DetectedStaff[];
}) {
  const spacing = new Map(staves.map((s) => [s.id, s.spacing]));
  return (
    <>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
          <rect x={0} y={0} width={width} height={height} fill="#fff" />
          {notes.map((n) => {
            const sp = spacing.get(n.staff) ?? 0;
            if (!sp) return null;
            return (
              <ellipse key={n.id} cx={n.x} cy={n.y} rx={sp * 1.5} ry={sp * 1.25} fill="#000" />
            );
          })}
        </mask>
      </defs>
      {/* White, not paper: what is being covered is the printed page, and it is
          white in both themes because it is a picture of paper. */}
      <rect
        data-veil=""
        className="pointer-events-none"
        x={0}
        y={0}
        width={width}
        height={height}
        fill="#fff"
        opacity={0.62}
        mask={`url(#${id})`}
      />
    </>
  );
});

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
  /** The part being worked on, if any, and whether taps are tagging into it. */
  currentPart,
  tagging,
}: {
  notes: DetectedNote[];
  staves: DetectedStaff[];
  score: PageScore;
  selected: string | null;
  currentPart: string | null;
  tagging: boolean;
}) {
  const parts = scoreParts(score);
  const partOf = score.partOf ?? {};
  const soloing = currentPart != null && !tagging;
  return (
    <>
      {notes.map((n) => {
        const staff = staves.find((s) => s.id === n.staff);
        if (!staff) return null;
        const part = partOf[n.id] ?? null;
        // Soloing already dims the rest of the page. A coloured dot on top of
        // something being deliberately hidden is an argument with itself.
        if (soloing && part !== currentPart) return null;
        const on = selected === n.id;
        const edited = (score.nudges[n.id] ?? 0) !== 0 || n.id in (score.alters ?? {});
        const index = part ? parts.findIndex((p) => p.id === part) : -1;
        const ink = index >= 0 ? partInk(index) : null;
        // While tagging, the other parts step back so the untagged notes — the
        // ones there is still work to do on — are the ones that stand out.
        const aside = tagging && currentPart != null && part != null && part !== currentPart;
        /**
         * A reading the detector only just believed. Drawn as an outline rather
         * than a solid, so that a guess and a certainty are not shown in the
         * same ink.
         *
         * Almost nothing is marked this way, and that is the point: on a PDF
         * whose noteheads were read out of the file there is nothing to doubt,
         * and even on a photograph the reader is genuinely sure of most of what
         * it keeps — anything that matched poorly was thrown out rather than
         * shown. What is left here is the handful that only half looked right,
         * which is where a wrong note will be if there is one.
         */
        const unsure = !on && !edited && (n.confidence ?? 1) < 0.6;
        return (
          <ellipse
            key={n.id}
            cx={n.x}
            cy={n.y}
            /* A part's dot is drawn wider than the notehead it marks, because
               the head itself is black and stays black: what carries the colour
               is the ring of paper around it, and a ring the same size as the
               head is no ring at all. */
            rx={staff.spacing * (ink && !on ? 1.02 : 0.78)}
            ry={staff.spacing * (ink && !on ? 0.8 : 0.6)}
            fill={
              unsure
                ? 'none'
                : on
                  ? 'rgb(var(--pink))'
                  : (ink ?? (edited ? 'rgb(var(--gold))' : 'rgb(var(--blue))'))
            }
            /* A note in a part already wears a colour, so a correction cannot
               also be a colour — it becomes a ring around the same dot, and the
               two things stay legible at once. */
            stroke={
              unsure
                ? (ink ?? 'rgb(var(--blue))')
                : ink && edited
                  ? 'rgb(var(--gold))'
                  : 'none'
            }
            strokeWidth={unsure || (ink && edited) ? 2 : 0}
            strokeDasharray={unsure ? '4 3' : undefined}
            vectorEffect="non-scaling-stroke"
            opacity={on ? 0.5 : aside ? 0.12 : ink ? 0.62 : edited ? 0.36 : unsure ? 0.5 : 0.16}
            /**
             * Overprinted, like the ink this design is named after.
             *
             * A wash laid over a notehead in the ordinary way is invisible —
             * the head is black, and black tinted 30% is black — so a page of
             * tagged notes came out looking exactly like a page of untagged
             * ones. Multiplied, the colour lands on the paper around the head
             * and the printed head stays as black as it was printed. The part
             * reads across the room, and nothing of the page is covered up.
             */
            style={ink && !on ? { mixBlendMode: 'multiply' } : undefined}
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
  const addNoteAt = useApp((s) => s.addNoteAt);
  const removeNote = useApp((s) => s.removeNote);
  const currentPart = useApp((s) => s.currentPart);
  const tagging = useApp((s) => s.tagging);
  const setCurrentPart = useApp((s) => s.setCurrentPart);
  const setTagging = useApp((s) => s.setTagging);
  const assignPart = useApp((s) => s.assignPart);

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
  const [heard, setHeard] = useState<{
    note: string | null;
    label: string;
    /** Where on the page it happened — what "add a note here" needs to know. */
    at?: { page: number; staff: string; x: number; y: number };
  } | null>(null);
  /** The last clef change, so it can be narrowed back to a single staff. */
  const [clefEdit, setClefEdit] = useState<{
    staffId: string;
    clef: ClefId;
    count: number;
    prev: Record<string, ClefId>;
  } | null>(null);

  /** A mouse press, which glides as it moves. Touch never gets here. */
  const dragging = useRef(false);
  /**
   * A finger on the page.
   *
   * Nothing sounds until it lifts or until it has been still long enough to be
   * deliberate, because until then there is no telling a tap from the start of
   * a scroll — and sounding on the way past is how a page turn ends up playing
   * four notes you did not want. Holding still is what the page cannot mistake
   * for anything else, so that is what unlocks the two things a plain tap must
   * not do: sound a pitch where no note was found, and take the gesture over
   * from the scroller so a slide can play a phrase.
   */
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    page: number;
    at: number;
    moved: boolean;
    held: boolean;
    glided: boolean;
  } | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const glide = useRef<{ page: number; staff: string; x: number } | null>(null);
  /** Where the glide has reached, drawn across the staff. */
  const [playhead, setPlayhead] = useState<{
    page: number;
    x: number;
    top: number;
    bottom: number;
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

  // Arrow keys still correct a note's line, for anyone with a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // 1–4 pick a part, 0 goes back to the whole score, T tags into it. The
      // parts bar says the same thing in words; this is for the hand that is
      // already going to tap a hundred notes.
      const state = useApp.getState();
      if (!state.score) return;
      if (/^[1-9]$/.test(e.key)) {
        const part = scoreParts(state.score)[Number(e.key) - 1];
        if (!part) return;
        e.preventDefault();
        setCurrentPart(state.currentPart === part.id ? null : part.id);
        return;
      }
      if (e.key === '0' && state.currentPart) {
        e.preventDefault();
        setCurrentPart(null);
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setTagging(!state.tagging);
        return;
      }
      // Escape backs out one step at a time — out of tagging, then out of the
      // part, then out of the selection — rather than everything at once.
      if (e.key === 'Escape' && state.tagging) {
        setTagging(false);
        return;
      }
      if (e.key === 'Escape' && state.currentPart) {
        setCurrentPart(null);
        return;
      }
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
  }, [nudgeSelected, select, setCurrentPart, setTagging]);

  // Once a hold has taken the gesture over, the page must not scroll out from
  // under the finger. touch-action is decided when a gesture starts, so the only
  // way to change our mind partway is to cancel the move itself — which needs a
  // listener the browser will let say no.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const stop = (e: TouchEvent) => {
      if (press.current?.held) e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);

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

  /**
   * A part chosen, and taps playing rather than tagging: the score is soloed
   * down to that line. Tagging deliberately un-solos, because you cannot put a
   * note into a part you have hidden.
   */
  const solo = tagging ? null : currentPart;
  const parts = scoreParts(score);
  const partOf = score.partOf ?? {};
  /** Whether a note answers to a tap or a glide right now. */
  const live = (n: DetectedNote) => !solo || partOf[n.id] === solo;
  const partNameOf = (id: string): { name: string; ink: string } | undefined => {
    const p = partOf[id];
    const i = p ? parts.findIndex((x) => x.id === p) : -1;
    return i >= 0 ? { name: parts[i].name, ink: partInk(i) } : undefined;
  };

  /** Which staff a point falls on — the nearest one within reach. */
  const staffAt = (page: number, y: number): DetectedStaff | null => {
    const staves = stavesByPage.get(page) ?? [];
    let best: DetectedStaff | null = null;
    let bestDistance = Infinity;
    for (const s of staves) {
      /**
       * As far out as the reader is willing to find a note, and no less.
       *
       * These two numbers have to agree, and they did not: recognition accepts
       * a notehead up to four and a half spaces off the staff — that is what
       * ledger lines are for, and a bass part lives down there — while a tap
       * only reached three and a bit. A note found at four spaces was drawn on
       * the page, was in every glide, and could not be tapped: aiming at its
       * lower half fell outside every staff and did nothing at all. The staff
       * nearest the point still wins, so reaching further cannot hand a point
       * to the wrong staff; it only stops the app disowning notes it found.
       */
      const reach = s.spacing * 4.5;
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
   * Height decides the pitch, so height decides which note: a tap is read as
   * the nearest notehead, weighted so that being close in pitch counts for far
   * more than being close along the line. Sideways the target is wide, because
   * the next note along is further away than a fingertip and there is nothing
   * else the tap could have meant.
   */
  const aimAt = (page: number, imgX: number, imgY: number): Aim | null => {
    const staff = staffAt(page, imgY);
    if (!staff) return null;
    const sp = staff.spacing;

    let best: DetectedNote | null = null;
    let bestScore = Infinity;
    /** The nearest note that a soloed part is currently keeping quiet. */
    let hushed: DetectedNote | null = null;
    let hushedScore = Infinity;
    for (const n of notesByPage.get(page) ?? []) {
      if (n.staff !== staff.id) continue;
      const dy = Math.abs(n.y - imgY);
      const dx = Math.abs(n.x - imgX);
      if (dy > sp * 1.8 || dx > sp * 3.2) continue;
      const score = dy * 3 + dx;
      if (live(n)) {
        if (score < bestScore) {
          bestScore = score;
          best = n;
        }
      } else if (score < hushedScore) {
        hushedScore = score;
        hushed = n;
      }
    }

    // A note of another part, under the finger, while one part is soloed. It is
    // named and coloured for the part it is in rather than passed over in
    // silence: "nothing happened" is a bug report, "that one is the Alto" is an
    // answer, and they look identical from the outside.
    if (!best && hushed) {
      return {
        page,
        staff: staff.id,
        note: null,
        x: hushed.x,
        y: hushed.y,
        radius: sp,
        label: noteName(hushed, staff, score),
        muted: partNameOf(hushed.id),
      };
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

    // Nothing within reach. The marker sits on the exact line or space that
    // *would* sound, so a miss is visible as a miss rather than heard as one.
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

  const land = (target: Aim, note: DetectedNote | null, staff: DetectedStaff) => {
    showAim(target);
    holdAim();
    if (note) {
      select(note.id);
      setHeard({ note: note.id, label: noteName(note, staff, score) });
      soundNote(note);
    } else {
      select(null);
      setHeard({
        note: null,
        label: target.label,
        at: { page: target.page, staff: staff.id, x: target.x, y: target.y },
      });
      sound(stepToMidi(stepAt(staff, target.y), staff.clef, staffSharps(staff, score)));
    }
  };

  /**
   * A tap. It plays a notehead and nothing else — landing between the notes and
   * hearing a pitch nobody wrote was the commonest way to be surprised by this
   * app. The pitch at an arbitrary spot is still there, on a press-and-hold,
   * where it cannot happen by accident.
   */
  const tapAt = (page: number, imgX: number, imgY: number) => {
    const target = aimAt(page, imgX, imgY);
    if (!target) return;
    const staff = score.staves.find((s) => s.id === target.staff);
    if (!staff) return;
    showAim(target);
    holdAim();
    if (!target.note) return; // shown, not sounded: the marker says why
    const note = score.notes.find((n) => n.id === target.note) ?? null;
    /**
     * Tagging: the tap puts this note in the part, and plays it — you have to
     * hear what you just claimed, or a mis-tap is invisible until you play the
     * line back. Tapping a note already in the part takes it out again, which
     * is the same "tap the lit one to take it back" the accidental buttons use,
     * and on a phone it is the only undo there is.
     */
    if (note && tagging && currentPart) {
      assignPart([note.id], partOf[note.id] === currentPart ? null : currentPart);
    }
    land(target, note, staff);
  };

  /** A press held still: the pitch at that exact line or space, whatever is there. */
  const freeAt = (page: number, imgX: number, imgY: number) => {
    const staff = staffAt(page, imgY);
    if (!staff) return;
    const step = stepAt(staff, imgY);
    const target: Aim = {
      page,
      staff: staff.id,
      note: null,
      x: imgX,
      y: staff.lines[4] - step * (staff.spacing / 2),
      radius: staff.spacing,
      label: stepToName(step, staff.clef, staffSharps(staff, score)),
    };
    land(target, null, staff);
  };

  /**
   * Gliding along a staff, playing the notes as they pass.
   *
   * A phrase is a shape in time, and clicking one note at a time never quite
   * gives you that. Dragging does: the speed of the hand is the tempo, and the
   * intervals arrive in order.
   *
   * Where two voices share a staff, the finger's *height* chooses between them
   * — trace the upper line and you hear the upper line. A chord is one event
   * with one note taken from it, rather than a handful at once, which keeps a
   * glide sounding like a line rather than like a wash.
   */
  const beginGlide = (page: number, imgX: number, imgY: number) => {
    const staff = staffAt(page, imgY);
    glide.current = staff ? { page, staff: staff.id, x: imgX } : null;
    setPlayhead(
      staff
        ? {
            page,
            x: imgX,
            top: staff.top - staff.spacing * 2.4,
            bottom: staff.bottom + staff.spacing * 2.4,
          }
        : null,
    );
  };

  const glideTo = (page: number, imgX: number, imgY: number) => {
    const g = glide.current;
    if (!g || g.page !== page) return;
    const staff = score.staves.find((s) => s.id === g.staff);
    if (!staff) return;
    setPlayhead((p) => (p ? { ...p, x: imgX } : p));

    const lo = Math.min(g.x, imgX);
    const hi = Math.max(g.x, imgX);
    g.x = imgX;
    const crossed = (notesByPage.get(page) ?? [])
      .filter((n) => n.staff === staff.id && n.x > lo && n.x <= hi && live(n))
      .sort((a, b) => a.x - b.x);
    if (!crossed.length) return;

    // One note per column, the one nearest the finger.
    const line: DetectedNote[] = [];
    for (const n of crossed) {
      const last = line[line.length - 1];
      if (last && Math.abs(last.x - n.x) < staff.spacing * 0.8) {
        if (Math.abs(n.y - imgY) < Math.abs(last.y - imgY)) line[line.length - 1] = n;
        continue;
      }
      line.push(n);
    }
    /**
     * Dragging is already how a phrase is played, so dragging is how a phrase
     * is tagged — and the same rule decides which note it means. Trace the line
     * you are singing and it goes into your part, note by note, at the speed of
     * your hand. That is what turns a thousand taps into a dozen strokes.
     *
     * A drag only ever puts notes *in*. Toggling a note off is a deliberate tap
     * on one note, or a stroke with a different part chosen — a drag that took
     * notes back out wherever it re-crossed them would be unusable.
     */
    if (tagging && currentPart) {
      const add = line.filter((n) => partOf[n.id] !== currentPart).map((n) => n.id);
      if (add.length) assignPart(add, currentPart);
    }
    for (const n of line) soundNote(n);

    const last = line[line.length - 1];
    select(last.id);
    setHeard({ note: last.id, label: noteName(last, staff, score) });
    showAim({
      page,
      staff: staff.id,
      note: last.id,
      x: last.x,
      y: last.y,
      radius: staff.spacing,
      label: noteName(last, staff, score),
    });
  };

  const endGlide = () => {
    glide.current = null;
    setPlayhead(null);
    holdAim();
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
  const heardPartIndex = heardNote ? parts.findIndex((p) => p.id === partOf[heardNote.id]) : -1;

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
                    const r = e.currentTarget.getBoundingClientRect();
                    const ix = ((e.clientX - r.left) / r.width) * page.width;
                    const iy = ((e.clientY - r.top) / r.height) * page.height;

                    if (e.pointerType === 'mouse') {
                      // Capture is a nicety — it keeps a drag alive off the
                      // edge of the page. It also throws if the pointer has
                      // already gone, and an exception here would take the rest
                      // of this handler with it: the note would not sound and
                      // the drag would never start.
                      try {
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                      } catch {
                        /* no capture, and nothing lost that matters */
                      }
                      dragging.current = true;
                      // Alt is the desktop way to ask for a pitch where no note
                      // was found; a plain press plays the note and starts a glide.
                      if (e.altKey) freeAt(page.index, ix, iy);
                      else {
                        tapAt(page.index, ix, iy);
                        beginGlide(page.index, ix, iy);
                      }
                      return;
                    }

                    press.current = {
                      id: e.pointerId,
                      x: e.clientX,
                      y: e.clientY,
                      page: page.index,
                      at: Date.now(),
                      moved: false,
                      held: false,
                      glided: false,
                    };
                    showAim(aimAt(page.index, ix, iy));
                    window.clearTimeout(aimTimer.current);
                    window.clearTimeout(holdTimer.current);
                    holdTimer.current = window.setTimeout(() => {
                      const p = press.current;
                      if (!p || p.moved) return;
                      p.held = true;
                      beginGlide(p.page, ix, iy);
                    }, 300);
                  }}
                  onPointerMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const ix = ((e.clientX - r.left) / r.width) * page.width;
                    const iy = ((e.clientY - r.top) / r.height) * page.height;

                    if (e.pointerType === 'mouse') {
                      if (dragging.current) glideTo(page.index, ix, iy);
                      else showAim(aimAt(page.index, ix, iy));
                      return;
                    }

                    const p = press.current;
                    if (!p || p.id !== e.pointerId) return;
                    if (p.held) {
                      p.glided = true;
                      glideTo(page.index, ix, iy);
                      return;
                    }
                    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 9) {
                      // The finger is travelling: this is a scroll, not a tap.
                      p.moved = true;
                      window.clearTimeout(holdTimer.current);
                      clearAim();
                    } else showAim(aimAt(page.index, ix, iy));
                  }}
                  onPointerUp={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const ix = ((e.clientX - r.left) / r.width) * page.width;
                    const iy = ((e.clientY - r.top) / r.height) * page.height;

                    if (e.pointerType === 'mouse') {
                      dragging.current = false;
                      endGlide();
                      return;
                    }

                    window.clearTimeout(holdTimer.current);
                    const p = press.current;
                    press.current = null;
                    if (!p || p.id !== e.pointerId || p.moved) {
                      endGlide();
                      clearAim();
                      return;
                    }
                    // Held still and let go: the pitch at that spot, note or no
                    // note. Held and slid: the phrase has already played.
                    // While tagging there is nothing to put a bare staff line
                    // into, so a hold that goes nowhere does nothing.
                    if (p.held && !p.glided) {
                      if (!tagging) freeAt(page.index, ix, iy);
                    } else if (!p.held) tapAt(page.index, ix, iy);
                    endGlide();
                  }}
                  /* The browser fires this the moment it decides the gesture is
                     a scroll, which is precisely when nothing should play. */
                  onPointerCancel={() => {
                    press.current = null;
                    dragging.current = false;
                    window.clearTimeout(holdTimer.current);
                    endGlide();
                    clearAim();
                  }}
                  /* A touch pointer stops existing the moment it lifts, so the
                     browser fires leave straight after up. Clearing the marker
                     there would wipe it in the same frame it was earned. */
                  onPointerLeave={(e) => {
                    if (e.pointerType !== 'mouse') return;
                    dragging.current = false;
                    endGlide();
                    clearAim();
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

                  {/* Everything but this part, put behind glass. */}
                  {solo && (
                    <Veil
                      id={`veil-${page.index}`}
                      width={page.width}
                      height={page.height}
                      notes={notes.filter((n) => partOf[n.id] === solo)}
                      staves={staves}
                    />
                  )}

                  {/* The dots are what carries the part colours, so choosing a
                      part brings them back even if they were switched off —
                      hiding them and then colouring them would be two settings
                      quietly disagreeing. */}
                  {(showNotes || currentPart) && (
                    <Dots
                      notes={notes}
                      staves={staves}
                      score={score}
                      selected={selected}
                      currentPart={currentPart}
                      tagging={tagging}
                    />
                  )}

                  {/* Where the glide has reached. The speed of the hand is the
                      tempo, so the line is the only clock there is. */}
                  {playhead && playhead.page === page.index && (
                    <line
                      data-playhead=""
                      className="pointer-events-none"
                      x1={playhead.x}
                      x2={playhead.x}
                      y1={playhead.top}
                      y2={playhead.bottom}
                      stroke="rgb(var(--pink))"
                      strokeWidth={2}
                      opacity={0.55}
                      vectorEffect="non-scaling-stroke"
                    />
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
                      data-aim={aim.note ? 'note' : aim.muted ? 'muted' : 'staff'}
                      className="pointer-events-none"
                      stroke={aim.muted ? aim.muted.ink : 'rgb(var(--pink))'}
                      fill="none"
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    >
                      {aim.muted ? (
                        <ellipse
                          cx={aim.x}
                          cy={aim.y}
                          rx={aim.radius * 1.05}
                          ry={aim.radius * 0.82}
                          strokeDasharray="5 4"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : aim.note ? (
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
                      background: aim.muted ? aim.muted.ink : 'rgb(var(--pink))',
                      color: '#fff',
                    }}
                  >
                    {aim.label}
                    {/* This note is another part's, and a soloed part is playing
                        alone on purpose. Saying whose it is turns silence into
                        an answer — and naming the part is also how you know
                        which chip to tap to go and hear it. */}
                    {aim.muted && (
                      <span className="ml-1 font-normal opacity-80">· {aim.muted.name}</span>
                    )}
                    {/* Nothing was found here, so a tap will not sound it. The
                        way to hear it anyway is the one gesture a scroll can
                        never be mistaken for, and saying so at the moment of
                        confusion is the only place anyone would read it. */}
                    {!aim.note && !aim.muted && (
                      <span className="ml-1 font-normal opacity-80">
                        <span className="[@media(pointer:coarse)]:hidden">· alt</span>
                        <span className="hidden [@media(pointer:coarse)]:inline">· hold</span>
                      </span>
                    )}
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

      {/* What you just heard, named. This is the only way to tell whether the
          app agrees with the page in front of you, so it is a readout first —
          and the accidental buttons say what is *printed*, which is something
          you can read off the page, rather than asking you to work out which
          way the pitch should move. */}
      {heard && (
        <div className="sticky bottom-2 z-20 mx-auto flex w-fit max-w-[calc(100%-24px)] flex-wrap items-center justify-center gap-2 border-[1.5px] border-ink bg-panel px-3 py-2 shadow-stamp">
          <span className="lbl hidden sm:inline">Heard</span>
          <span className="font-display text-[17px] font-bold leading-none">{heardLabel}</span>
          {heardNote ? (
            <>
              {/* While tagging, the panel is about which line this note is on,
                  not about what is printed beside it. Two rows of buttons for
                  two different questions would leave both harder to find, and
                  only one of them is being asked. */}
              {tagging ? (
                <>
                  <span className="lbl ml-1">Part</span>
                  <div className="flex gap-1">
                    {parts.map((p, i) => {
                      const on = partOf[heardNote.id] === p.id;
                      return (
                        <button
                          key={p.id}
                          className="btn px-2.5"
                          style={
                            on
                              ? { background: partInk(i), borderColor: partInk(i), color: '#fff' }
                              : { borderColor: partInk(i) }
                          }
                          aria-pressed={on}
                          title={on ? `Take it out of ${p.name}` : `Put this note in ${p.name}`}
                          onClick={() => assignPart([heardNote.id], on ? null : p.id)}
                        >
                          {partShort(p.name)}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
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
                  {heardPartIndex >= 0 && (
                    <span
                      className="lbl flex items-center gap-1 whitespace-nowrap"
                      title={`This note is in ${parts[heardPartIndex].name}`}
                    >
                      <span
                        className="inline-block h-[9px] w-[9px] rounded-full"
                        style={{ background: partInk(heardPartIndex) }}
                      />
                      {parts[heardPartIndex].name}
                    </span>
                  )}
                </>
              )}
              {/* A note the reader imagined. Taking it away is the other half
                  of being able to add one, and without it a phantom stays in
                  every glide over that bar for as long as the score exists. */}
              <button
                className="btn btn-ghost ml-1"
                title="There is no note here on the page — take it off"
                onClick={() => {
                  removeNote(heardNote.id);
                  setHeard(null);
                }}
              >
                Not a note
              </button>
            </>
          ) : (
            <>
              <span className="lbl hidden sm:inline">from the staff line</span>
              {/* Nothing was found here, and you are looking straight at one.
                  Putting it in makes it clickable, glideable and permanent —
                  which no amount of further tuning of the reader could do for
                  the note it happens to miss on your page. */}
              {heard.at && (
                <button
                  className="btn ml-1"
                  title="Add a note here, so it plays with the rest"
                  onClick={() => {
                    const spot = heard.at!;
                    const added = addNoteAt(spot.page, spot.staff, spot.x, spot.y);
                    if (added) {
                      const staff = score.staves.find((s) => s.id === added.staff);
                      setHeard({
                        note: added.id,
                        label: staff ? noteName(added, staff, score) : heard.label,
                      });
                    }
                  }}
                >
                  + Add note
                </button>
              )}
            </>
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
