import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { canEdit, noteToRest, setLyric, shiftNote } from '../../lib/score/edit';
import { midiName } from '../../lib/score/types';
import { inkVar } from '../../lib/score/types';

/**
 * The correction bar.
 *
 * Recognition gets things wrong, and a score you can't fix is a score you can't
 * trust. Two keystrokes per note is the target: arrow to it, arrow to correct
 * it, hear the result immediately.
 */
export default function NoteEditor() {
  const score = useApp((s) => s.score);
  const editing = useApp((s) => s.editing);
  const selected = useApp((s) => s.selected);
  const status = useApp((s) => s.editStatus);
  const undoStack = useApp((s) => s.undoStack);
  const applyEdit = useApp((s) => s.applyEdit);
  const undoEdit = useApp((s) => s.undoEdit);
  const moveSelection = useApp((s) => s.moveSelection);
  const selectNote = useApp((s) => s.selectNote);
  const [lyricDraft, setLyricDraft] = useState('');

  const editable = useMemo(() => (score ? canEdit(score) : { ok: false }), [score]);

  const note = useMemo(() => {
    if (!score || !selected) return null;
    return score.notes.find((n) => n.part === selected.part && n.ordinal === selected.ordinal) ?? null;
  }, [score, selected]);

  useEffect(() => {
    setLyricDraft(note?.syllable ?? '');
  }, [note?.id, note?.syllable]);

  // Keyboard editing. Only active while the editor is open, so the arrow keys
  // still belong to step mode the rest of the time.
  useEffect(() => {
    if (!editing || !editable.ok) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undoEdit();
        return;
      }
      if (!selected) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          void applyEdit((s, target) => shiftNote(s, target, e.shiftKey ? 12 : 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          void applyEdit((s, target) => shiftNote(s, target, e.shiftKey ? -12 : -1, true));
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          moveSelection(-1);
          break;
        case 'Backspace':
        case 'Delete':
          e.preventDefault();
          void applyEdit((s, target) => noteToRest(s, target));
          break;
        case 'Escape':
          e.preventDefault();
          selectNote(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, editable.ok, selected, applyEdit, undoEdit, moveSelection, selectNote]);

  if (!editing || !score) return null;

  if (!editable.ok) {
    return (
      <div className="border-t-[1.5px] border-ink bg-panel px-3 py-2.5">
        <div className="lbl mb-1" style={{ color: 'rgb(var(--warn))' }}>
          Editing unavailable
        </div>
        <p className="max-w-[70ch] text-[13.5px] leading-snug text-ink2">{editable.reason}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t-[1.5px] border-ink bg-panel2 px-3 py-2.5">
      {note ? (
        <>
          <span className="h-6 w-[5px] shrink-0" style={{ background: inkVar(note.part) }} />
          <div className="min-w-[128px]">
            <div className="font-display text-[14px] font-bold leading-tight tracking-tight">
              {midiName(note.midi)}
            </div>
            <div className="lbl">
              {score.parts[note.part]?.name} · bar {note.measure}
            </div>
          </div>

          <div className="mx-1 h-6 w-px bg-rule2" />

          <button className="btn" onClick={() => void applyEdit((s, t) => shiftNote(s, t, 1))} title="Up a semitone (↑)">
            ♯ up
          </button>
          <button
            className="btn"
            onClick={() => void applyEdit((s, t) => shiftNote(s, t, -1, true))}
            title="Down a semitone (↓)"
          >
            ♭ down
          </button>
          <button
            className="btn"
            onClick={() => void applyEdit((s, t) => shiftNote(s, t, 12))}
            title="Up an octave (shift ↑)"
          >
            +8ve
          </button>
          <button
            className="btn"
            onClick={() => void applyEdit((s, t) => shiftNote(s, t, -12))}
            title="Down an octave (shift ↓)"
          >
            −8ve
          </button>
          <button
            className="btn"
            onClick={() => void applyEdit((s, t) => noteToRest(s, t))}
            title="Replace with a rest of the same length (delete)"
          >
            → rest
          </button>

          <div className="mx-1 h-6 w-px bg-rule2" />

          <input
            className="field w-28"
            value={lyricDraft}
            placeholder="syllable"
            onChange={(e) => setLyricDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void applyEdit((s, t) => setLyric(s, t, lyricDraft));
              e.stopPropagation();
            }}
            onBlur={() => {
              if (lyricDraft !== (note.syllable ?? '')) void applyEdit((s, t) => setLyric(s, t, lyricDraft));
            }}
            aria-label="Lyric syllable for this note"
          />

          <button className="btn btn-ghost" onClick={() => moveSelection(-1)} title="Previous note (←)">
            ‹
          </button>
          <button className="btn btn-ghost" onClick={() => moveSelection(1)} title="Next note (→)">
            ›
          </button>
        </>
      ) : (
        <span className="text-[13.5px] text-ink2">
          Click a note in the score to correct it. Then <span className="lbl">↑ ↓</span> to move it by a semitone,{' '}
          <span className="lbl">shift ↑ ↓</span> by an octave, <span className="lbl">delete</span> to clear it.
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {status && <span className="lbl">{status}</span>}
        <button className="btn btn-ghost" onClick={() => void undoEdit()} disabled={!undoStack.length} title="Undo (⌘Z)">
          Undo{undoStack.length ? ` (${undoStack.length})` : ''}
        </button>
      </div>
    </div>
  );
}
