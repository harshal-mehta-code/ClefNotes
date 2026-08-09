import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { partInk, partShort, scoreParts } from '../lib/detect/types';

/**
 * Parts — the four lines of the music, told to the app rather than read off the
 * page.
 *
 * Everything here hangs off one choice: which part you are on. With one chosen
 * the page belongs to it — its notes stay lit, the rest of the score falls
 * back, and a tap or a glide plays that line and nothing else. That is the
 * thing a singer wants and the thing a printed page cannot do: hear my line,
 * with the others out of the way.
 *
 * Turning on **Tag** makes the same choice mean the opposite direction: now a
 * tap *puts* the note into the part instead of playing only the notes already
 * in it. One selection, two modes, and no third state to explain — and because
 * dragging is already how you play a phrase, dragging is also how you tag one.
 *
 * It sits at the bottom because that is where a thumb is, and it stays a single
 * quiet line because a score you are reading should not have to share the
 * screen with a control panel.
 */
export default function Parts() {
  const score = useApp((s) => s.score);
  const currentPart = useApp((s) => s.currentPart);
  const setCurrentPart = useApp((s) => s.setCurrentPart);
  const tagging = useApp((s) => s.tagging);
  const setTagging = useApp((s) => s.setTagging);
  const renamePart = useApp((s) => s.renamePart);
  const clearPart = useApp((s) => s.clearPart);
  const autoAssignParts = useApp((s) => s.autoAssignParts);
  const restorePartOf = useApp((s) => s.restorePartOf);

  const [naming, setNaming] = useState(false);
  /** The last sweeping change, so it can be taken back. */
  const [undo, setUndo] = useState<{ label: string; partOf: Record<string, string> } | null>(null);

  const parts = score ? scoreParts(score) : [];
  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const p of Object.values(score?.partOf ?? {})) tally.set(p, (tally.get(p) ?? 0) + 1);
    return tally;
  }, [score]);

  if (!score) return null;
  const current = parts.find((p) => p.id === currentPart) ?? null;
  const currentIndex = parts.findIndex((p) => p.id === currentPart);
  const tagged = Object.keys(score.partOf ?? {}).length;

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto border-b border-rule bg-panel px-2 py-1"
      style={{
        // The bar wears the part you are on, so the mode is visible from the
        // page rather than only from the chip that set it.
        boxShadow: current ? `inset 3px 0 0 ${partInk(currentIndex)}` : undefined,
      }}
    >
      <span className="lbl hidden shrink-0 sm:inline">Part</span>

      {parts.map((p, i) => {
        const on = p.id === currentPart;
        const n = counts.get(p.id) ?? 0;
        const ink = partInk(i);
        if (naming) {
          return (
            <span key={p.id} className="flex shrink-0 items-center gap-1">
              <span
                className="inline-block h-[9px] w-[9px] shrink-0 rounded-full"
                style={{ background: ink }}
              />
              <input
                className="field w-[88px] px-1.5 py-0.5"
                value={p.name}
                onChange={(e) => renamePart(p.id, e.target.value)}
                aria-label={`Name of part ${i + 1}`}
              />
            </span>
          );
        }
        return (
          <button
            key={p.id}
            className={`chip flex shrink-0 items-center gap-1.5 ${on ? 'chip-on' : ''}`}
            style={on ? { background: ink, borderColor: ink, color: '#fff' } : { borderColor: ink }}
            aria-pressed={on}
            title={
              on
                ? `${p.name} — ${n} note${n === 1 ? '' : 's'}. Tap again for the whole score.`
                : `Show and play only ${p.name}${n ? ` — ${n} notes` : ''} (key ${i + 1})`
            }
            onClick={() => setCurrentPart(on ? null : p.id)}
          >
            <span
              className="inline-block h-[9px] w-[9px] shrink-0 rounded-full"
              style={{ background: on ? '#fff' : ink }}
            />
            <span className="hidden sm:inline">{p.name}</span>
            <span className="sm:hidden">{partShort(p.name)}</span>
            {n > 0 && <span className="opacity-60">{n}</span>}
          </button>
        );
      })}

      <span className="mx-0.5 h-4 w-px shrink-0 bg-rule2" />

      <button
        className={`chip shrink-0 ${tagging ? 'chip-on' : ''}`}
        aria-pressed={tagging}
        title={
          tagging
            ? 'Stop tagging — taps go back to playing'
            : 'Tap or drag across notes to put them in this part (key T)'
        }
        onClick={() => setTagging(!tagging)}
      >
        {/* On a phone the word has to give way to the tools it turns on — the
            chip is already inverted, and the part chip beside it already says
            which part. */}
        <span className="sm:hidden">Tag</span>
        <span className="hidden sm:inline">
          {tagging ? `Tagging ${current ? current.name : ''}` : 'Tag'}
        </span>
      </button>

      {/* The editing tools only exist while you are editing. Sitting there the
          rest of the time they would be four more things to read past on a bar
          whose whole job is to stay out of the way. */}
      {tagging && (
        <>
          <button
            className="chip shrink-0"
            title="A first pass over the whole score from the way it is laid out — one part per staff, or the voices of each staff split top to bottom. Correct it by tapping."
            onClick={() => {
              const before = { ...(score.partOf ?? {}) };
              const n = autoAssignParts();
              setUndo(n ? { label: `${n} notes sorted by staff`, partOf: before } : null);
            }}
          >
            Auto
          </button>
          <button
            className="chip shrink-0"
            disabled={!current || !(counts.get(current.id) ?? 0)}
            title={current ? `Take every note out of ${current.name}` : 'Choose a part first'}
            onClick={() => {
              if (!current) return;
              const before = { ...(score.partOf ?? {}) };
              const n = clearPart(current.id);
              setUndo(n ? { label: `${current.name} cleared`, partOf: before } : null);
            }}
          >
            Clear
          </button>
          <button
            className={`chip shrink-0 ${naming ? 'chip-on' : ''}`}
            aria-pressed={naming}
            title="Rename the parts — they are Soprano, Alto, Tenor and Bass until you say otherwise"
            onClick={() => setNaming((v) => !v)}
          >
            {naming ? 'Done' : 'Rename'}
          </button>
        </>
      )}

      {undo && (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="lbl whitespace-nowrap">{undo.label}</span>
          <button
            className="chip shrink-0"
            onClick={() => {
              restorePartOf(undo.partOf);
              setUndo(null);
            }}
          >
            Undo
          </button>
          <button className="chip shrink-0" aria-label="Dismiss" onClick={() => setUndo(null)}>
            ✕
          </button>
        </span>
      )}

      {/* Said once, where a hand already is, and only while there is nothing to
          say instead. A feature nobody finds is a feature nobody has. */}
      {!tagging && !tagged && !undo && (
        <span className="lbl ml-auto hidden shrink-0 whitespace-nowrap sm:inline">
          Tag → then tap notes
        </span>
      )}
      {!tagging && tagged > 0 && current && !undo && (
        <span className="lbl ml-auto hidden shrink-0 whitespace-nowrap sm:inline">
          Only {current.name} plays
        </span>
      )}
    </div>
  );
}
