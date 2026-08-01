import { useState } from 'react';
import { useApp } from '../../state/store';
import { toMidiBase64 } from '../../lib/verovio/engraver';
import { renderToWav } from '../../lib/audio/render';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(title: string) {
  return title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'score';
}

export default function ExportMenu() {
  const score = useApp((s) => s.score);
  const mixes = useApp((s) => s.mixes);
  const transport = useApp((s) => s.transport);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!score) return null;
  const base = safeName(score.title);

  const exportWav = async () => {
    setBusy('Rendering audio…');
    try {
      const blob = await renderToWav(
        score,
        mixes,
        {
          bpm: transport.bpm * transport.rate,
          transpose: transport.transpose,
          reverb: transport.reverb,
        },
        (f) => setBusy(`Rendering audio… ${Math.round(f * 100)}%`),
      );
      download(blob, `${base}.wav`);
    } catch {
      alert('The audio render failed. Try a shorter score or a smaller loop.');
    }
    setBusy(null);
    setOpen(false);
  };

  const exportMidi = async () => {
    setBusy('Building MIDI…');
    try {
      const b64 = await toMidiBase64(score.musicXml);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      download(new Blob([bytes], { type: 'audio/midi' }), `${base}.mid`);
    } catch {
      alert('MIDI export failed for this score.');
    }
    setBusy(null);
    setOpen(false);
  };

  const exportXml = () => {
    download(new Blob([score.musicXml], { type: 'application/vnd.recordare.musicxml+xml' }), `${base}.musicxml`);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {busy ?? 'Export'}
      </button>
      {open && !busy && (
        <div className="absolute right-0 z-30 mt-1 w-56 border-[1.5px] border-ink bg-panel p-1 shadow-stamp">
          {[
            ['WAV · exactly what you hear', exportWav],
            ['MIDI · for any other app', exportMidi],
            ['MusicXML · the notation', exportXml],
          ].map(([label, fn]) => (
            <button
              key={label as string}
              className="block w-full px-2.5 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink2 hover:bg-ink hover:text-paper"
              onClick={fn as () => void}
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
