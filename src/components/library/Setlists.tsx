import { useMemo, useState } from 'react';
import { db, type StoredScore } from '../../lib/db/db';
import { Chip, Label } from '../ui/primitives';

/**
 * Setlists.
 *
 * A concert programme, a lesson plan, the four pieces for Saturday — a library
 * gets unusable at about twenty scores without some way to group them. Built on
 * the tags each score already carries, so there's no second thing to keep in
 * sync.
 */

export function useSetlists(library: StoredScore[]) {
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of library) {
      for (const tag of row.tags ?? []) {
        if (tag === 'shelf') continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [library]);
}

export function SetlistBar({
  library,
  active,
  onChange,
}: {
  library: StoredScore[];
  active: string | null;
  onChange: (tag: string | null) => void;
}) {
  const setlists = useSetlists(library);
  if (!setlists.length) return null;

  return (
    <section className="mb-6">
      <Label className="mb-2">Setlists</Label>
      <div className="flex flex-wrap gap-1.5">
        <Chip on={active === null} onClick={() => onChange(null)}>
          All {library.length}
        </Chip>
        {setlists.map(([tag, count]) => (
          <Chip key={tag} on={active === tag} onClick={() => onChange(active === tag ? null : tag)}>
            {tag} {count}
          </Chip>
        ))}
      </div>
    </section>
  );
}

/** The per-card control for putting a score into a setlist. */
export function SetlistPicker({
  score,
  library,
  onChanged,
}: {
  score: StoredScore;
  library: StoredScore[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const setlists = useSetlists(library);
  const tags = (score.tags ?? []).filter((t) => t !== 'shelf');

  const toggle = async (tag: string) => {
    const current = score.tags ?? [];
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    await db.scores.update(score.id, { tags: next });
    onChanged();
  };

  const create = async () => {
    const tag = draft.trim();
    if (!tag) return;
    await db.scores.update(score.id, { tags: [...(score.tags ?? []), tag] });
    setDraft('');
    setOpen(false);
    onChanged();
  };

  return (
    <div className="relative">
      <button
        className="btn btn-ghost"
        onClick={() => setOpen((v) => !v)}
        title="Add to a setlist"
        aria-expanded={open}
      >
        {tags.length ? `≡ ${tags.length}` : '≡'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-52 border-[1.5px] border-ink bg-panel p-2 shadow-stamp">
            <Label className="mb-1.5">Setlists</Label>
            {setlists.length === 0 && (
              <p className="mb-2 text-[12px] leading-snug text-ink3">None yet — name one below.</p>
            )}
            {setlists.map(([tag]) => (
              <button
                key={tag}
                onClick={() => void toggle(tag)}
                className="flex w-full items-center gap-2 px-1 py-1.5 text-left text-[13px] hover:bg-ink hover:text-paper"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 border border-rule2"
                  style={{ background: tags.includes(tag) ? 'rgb(var(--mint))' : 'transparent' }}
                />
                <span className="truncate">{tag}</span>
              </button>
            ))}
            <div className="mt-2 flex gap-1 border-t border-rule pt-2">
              <input
                className="field min-w-0 flex-1"
                placeholder="New setlist…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
                aria-label="New setlist name"
              />
              <button className="btn" onClick={() => void create()} disabled={!draft.trim()}>
                Add
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
