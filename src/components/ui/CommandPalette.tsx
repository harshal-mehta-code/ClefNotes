import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { SOUND_PACKS } from '../../lib/audio/instruments';
import { generatePhrase, seedFromDate } from '../../lib/score/generate';

/**
 * The command palette.
 *
 * An app with this many controls gets slow to drive by pointer. One shortcut
 * reaches everything — including things buried in panels — and it doubles as
 * the discovery surface: typing "slow" or "part" shows what the app can do
 * without anyone having to read documentation.
 */

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const store = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setIndex(0);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === '?' && !open) {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setOpen(true);
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'go-library', group: 'Go', label: 'Library', run: () => store.setView('library') },
      { id: 'go-import', group: 'Go', label: 'Import a score', run: () => store.setView('import') },
    ];

    if (store.score) {
      list.push(
        { id: 'go-studio', group: 'Go', label: 'Studio', run: () => store.setView('studio') },
        { id: 'go-lab', group: 'Go', label: 'Practice Lab', run: () => store.setView('lab') },
        { id: 'go-vox', group: 'Go', label: 'ClefVox', run: () => store.setView('vox') },

        {
          id: 'play',
          group: 'Transport',
          label: store.transport.playing ? 'Pause' : 'Play',
          hint: 'space',
          run: () => (store.transport.playing ? store.pause() : void store.play()),
        },
        { id: 'stop', group: 'Transport', label: 'Stop', hint: 'esc', run: () => store.stop() },
        {
          id: 'step',
          group: 'Transport',
          label: store.stepMode ? 'Leave step mode' : 'Step through note by note',
          run: () => store.setStepMode(!store.stepMode),
        },
        {
          id: 'metronome',
          group: 'Transport',
          label: store.transport.metronome ? 'Metronome off' : 'Metronome on',
          hint: 'm',
          run: () => store.patchTransport({ metronome: !store.transport.metronome }),
        },
        {
          id: 'countin',
          group: 'Transport',
          label: store.transport.countIn ? 'Count-in off' : 'Count-in on',
          run: () => store.patchTransport({ countIn: !store.transport.countIn }),
        },
        {
          id: 'loop-clear',
          group: 'Transport',
          label: 'Clear the loop',
          run: () => store.setLoopBars(null),
        },

        {
          id: 'tempo-marked',
          group: 'Tempo',
          label: `Back to the marked tempo (${store.score.bpm} BPM)`,
          run: () => store.patchTransport({ bpm: store.score!.bpm, rate: 1 }),
        },
      );

      for (const rate of [0.4, 0.5, 0.75, 1]) {
        list.push({
          id: `rate-${rate}`,
          group: 'Tempo',
          label: `Play at ${Math.round(rate * 100)}% speed`,
          run: () => store.patchTransport({ rate }),
        });
      }

      list.push(
        { id: 'view-sheet', group: 'View', label: 'Show the sheet music', run: () => store.setScoreMode('sheet') },
        { id: 'view-roll', group: 'View', label: 'Show the piano roll', run: () => store.setScoreMode('roll') },
        { id: 'view-split', group: 'View', label: 'Show both, split', run: () => store.setScoreMode('split') },
        {
          id: 'edit',
          group: 'View',
          label: store.editing ? 'Stop fixing notes' : 'Fix wrong notes',
          run: () => {
            store.setEditing(!store.editing);
            store.setView('studio');
          },
        },
      );

      store.score.parts.forEach((part, i) => {
        list.push({
          id: `solo-${i}`,
          group: 'Parts',
          label: `Hear only ${part.name}`,
          run: () => {
            store.soloOnly(i);
            store.setView('studio');
          },
        });
        list.push({
          id: `minus-${i}`,
          group: 'Parts',
          label: `Minus-one: mute ${part.name} and play it yourself`,
          run: () => {
            store.minusOne(i);
            store.setView('studio');
          },
        });
      });

      for (const pack of SOUND_PACKS) {
        list.push({
          id: `pack-${pack.id}`,
          group: 'Sound',
          label: `Sound pack: ${pack.name}`,
          hint: pack.blurb,
          run: () => store.applySoundPack(pack),
        });
      }
    }

    list.push(
      {
        id: 'daily',
        group: 'Practice',
        label: "Open today's sight-reading",
        run: () => {
          const seed = seedFromDate();
          const phrase = generatePhrase(3, seed);
          void store.loadScore(phrase.musicXml, { source: 'generated', id: `daily-${seed}` });
        },
      },
      {
        id: 'theme',
        group: 'App',
        label: 'Switch light / dark',
        run: () => store.setTheme(store.theme === 'dark' ? 'light' : 'dark'),
      },
    );

    return list;
  }, [store]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    // Subsequence match, so "sopr" finds "Hear only Soprano".
    return commands.filter((c) => {
      const hay = `${c.group} ${c.label} ${c.hint ?? ''}`.toLowerCase();
      let i = 0;
      for (const ch of q) {
        i = hay.indexOf(ch, i);
        if (i < 0) return false;
        i++;
      }
      return true;
    });
  }, [commands, query]);

  useEffect(() => {
    setIndex((i) => Math.max(0, Math.min(filtered.length - 1, i)));
  }, [filtered.length]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const run = (c: Command) => {
    c.run();
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[500] flex items-start justify-center bg-[rgb(var(--sunk))]/70 px-4 pt-[12vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-[560px] border-[1.5px] border-ink bg-panel shadow-stamp"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full border-b-[1.5px] border-ink bg-panel2 px-3.5 py-3 font-mono text-[13px] text-ink outline-none"
          placeholder="Type a command…  (try “slow”, “alto”, “8-bit”)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && filtered[index]) {
              e.preventDefault();
              run(filtered[index]);
            }
          }}
        />
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3.5 py-6 text-center text-[13.5px] text-ink3">Nothing matches that.</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              data-active={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
              className={`flex w-full items-baseline gap-2.5 px-3.5 py-2 text-left ${
                i === index ? 'bg-ink text-paper' : 'text-ink'
              }`}
            >
              <span
                className={`font-mono text-[9px] uppercase tracking-[0.14em] ${
                  i === index ? 'text-paper/70' : 'text-ink3'
                }`}
              >
                {c.group}
              </span>
              <span className="flex-1 text-[13.5px] leading-snug">{c.label}</span>
              {c.hint && (
                <span
                  className={`font-mono text-[9.5px] uppercase tracking-[0.1em] ${
                    i === index ? 'text-paper/70' : 'text-ink3'
                  }`}
                >
                  {c.hint}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-rule px-3.5 py-2">
          <span className="lbl">↑↓ move</span>
          <span className="lbl">↵ run</span>
          <span className="lbl">esc close</span>
          <span className="lbl ml-auto">{filtered.length} commands</span>
        </div>
      </div>
    </div>
  );
}
