import { useState } from 'react';
import { useApp } from '../../state/store';
import { inkVar, midiName } from '../../lib/score/types';
import { instrumentsByFamily, SOUND_PACKS } from '../../lib/audio/instruments';
import { VOICE_PRESETS } from '../../lib/audio/clefvox';
import { Label } from '../ui/primitives';

/**
 * Parts.
 *
 * This panel is the reason the app exists — hearing one line on its own is the
 * thing a printed score cannot do. So each part gets one row with the three
 * controls that matter, named in words: which instrument it plays, "Only" to
 * isolate it, and "Mute" to take it out.
 *
 * Everything else — volume, pan, octave, transposing instrument — is real but
 * secondary, and lives behind the row's expander. Eight controls per part is
 * how you end up with a musician who cannot find solo.
 */

const TRANSPOSING = [
  { label: 'Concert pitch', semitones: 0 },
  { label: 'B♭ (trumpet, clarinet, tenor sax)', semitones: 2 },
  { label: 'E♭ (alto sax, alto clarinet)', semitones: 9 },
  { label: 'F (horn, English horn)', semitones: 7 },
  { label: 'A (clarinet in A)', semitones: 3 },
  { label: 'B♭ bass (bass clarinet, tenor)', semitones: 14 },
];

export default function Mixer() {
  const score = useApp((s) => s.score);
  const mixes = useApp((s) => s.mixes);
  const setMix = useApp((s) => s.setMix);
  const soloOnly = useApp((s) => s.soloOnly);
  const applySoundPack = useApp((s) => s.applySoundPack);
  const packId = useApp((s) => s.packId);
  const transport = useApp((s) => s.transport);
  const patch = useApp((s) => s.patchTransport);
  const writtenTranspose = useApp((s) => s.writtenTranspose);
  const transposePartWritten = useApp((s) => s.transposePartWritten);
  const simpleMode = useApp((s) => s.simpleMode);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [showScoreOpts, setShowScoreOpts] = useState(false);

  if (!score) return null;
  const anySolo = mixes.some((m) => m.solo);
  const families = instrumentsByFamily();

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {/* One control, not ten chips. */}
      <section>
        <Label className="mb-1.5">Sound</Label>
        <select
          className="field w-full"
          value={packId}
          onChange={(e) => {
            const pack = SOUND_PACKS.find((p) => p.id === e.target.value);
            if (pack) applySoundPack(pack);
          }}
          aria-label="Sound pack for the whole score"
        >
          {SOUND_PACKS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.blurb}
            </option>
          ))}
        </select>
      </section>

      <section>
        <div className="mb-1.5 flex items-center gap-2">
          <Label>Parts · {score.parts.length}</Label>
          {anySolo && (
            <button
              className="lbl ml-auto underline decoration-riso-pink decoration-2"
              onClick={() => soloOnly(null)}
            >
              hear all again
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {score.parts.map((part, i) => {
            const mix = mixes[i];
            if (!mix) return null;
            const audible = anySolo ? mix.solo : !mix.muted;
            const isOpen = expanded === i;
            return (
              <div
                key={i}
                className="border"
                style={{
                  borderColor: mix.solo ? inkVar(i) : 'rgb(var(--rule-2))',
                  background: mix.solo ? 'rgb(var(--panel-2))' : 'transparent',
                  opacity: audible ? 1 : 0.55,
                }}
              >
                <div className="flex items-center gap-2 p-2">
                  <span className="h-9 w-[5px] shrink-0" style={{ background: inkVar(i) }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-[14px] font-bold leading-tight tracking-tight">
                      {part.name}
                    </div>
                    <div className="lbl truncate">
                      {midiName(part.lowMidi)}–{midiName(part.highMidi)}
                      {part.hasLyrics && ' · lyrics'}
                    </div>
                  </div>

                  <button
                    className={`part-btn ${mix.solo ? 'is-on' : ''}`}
                    onClick={() => (mix.solo ? soloOnly(null) : soloOnly(i))}
                    aria-pressed={mix.solo}
                    title={`Hear ${part.name} on its own`}
                  >
                    Only
                  </button>
                  <button
                    className={`part-btn ${mix.muted && !anySolo ? 'is-off' : ''}`}
                    onClick={() => setMix(i, { muted: !mix.muted, solo: false })}
                    aria-pressed={mix.muted}
                    title={`Take ${part.name} out — play it yourself`}
                  >
                    Mute
                  </button>
                  <button
                    className="part-btn"
                    onClick={() => setExpanded(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    title="Volume, pan, octave, transposing instrument"
                  >
                    {isOpen ? '×' : '⋯'}
                  </button>
                </div>

                {/* The instrument is on the row, not buried: it is the second
                    thing anyone wants to change after pressing play. */}
                <div className="flex items-center gap-2 px-2 pb-2">
                  <select
                    className="field min-w-0 flex-1"
                    value={mix.instrument}
                    onChange={(e) => setMix(i, { instrument: e.target.value as typeof mix.instrument })}
                    aria-label={`Instrument for ${part.name}`}
                  >
                    {families.map(([family, list]) => (
                      <optgroup key={family} label={family}>
                        {list.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {mix.instrument === 'voice' && (
                    <select
                      className="field"
                      value={mix.voiceType}
                      onChange={(e) => setMix(i, { voiceType: e.target.value as typeof mix.voiceType })}
                      aria-label={`Voice type for ${part.name}`}
                    >
                      {Object.values(VOICE_PRESETS).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-rule px-2 pb-2 pt-2">
                    <div className="flex items-center gap-2 py-0.5">
                      <span className="lbl w-9">Vol</span>
                      <input
                        type="range"
                        className="rng flex-1"
                        min={0}
                        max={1}
                        step={0.01}
                        value={mix.volume}
                        onChange={(e) => setMix(i, { volume: Number(e.target.value) })}
                        aria-label={`Volume for ${part.name}`}
                      />
                      <span className="num w-8 text-[10px] text-ink3">{Math.round(mix.volume * 100)}</span>
                    </div>
                    <div className="flex items-center gap-2 py-0.5">
                      <span className="lbl w-9">Pan</span>
                      <input
                        type="range"
                        className="rng flex-1"
                        min={-1}
                        max={1}
                        step={0.05}
                        value={mix.pan}
                        onChange={(e) => setMix(i, { pan: Number(e.target.value) })}
                        aria-label={`Pan for ${part.name}`}
                      />
                      <span className="num w-8 text-[10px] text-ink3">
                        {mix.pan === 0
                          ? 'C'
                          : mix.pan < 0
                            ? `L${Math.round(-mix.pan * 9)}`
                            : `R${Math.round(mix.pan * 9)}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 py-0.5">
                      <span className="lbl w-9">8ve</span>
                      <input
                        type="range"
                        className="rng flex-1"
                        min={-12}
                        max={12}
                        step={12}
                        value={mix.transpose}
                        onChange={(e) => setMix(i, { transpose: Number(e.target.value) })}
                        aria-label={`Octave shift for ${part.name}`}
                      />
                      <span className="num w-8 text-[10px] text-ink3">
                        {mix.transpose === 0 ? '0' : mix.transpose > 0 ? '+1' : '−1'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="lbl w-9">I play</span>
                      <select
                        className="field min-w-0 flex-1"
                        value={writtenTranspose[i] ?? 0}
                        onChange={(e) => void transposePartWritten(i, Number(e.target.value))}
                        aria-label={`Transposing instrument for ${part.name}`}
                        title="Rewrites this part to what you read; it still sounds in concert pitch"
                      >
                        {TRANSPOSING.map((t) => (
                          <option key={t.semitones} value={t.semitones}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="lbl mt-2 leading-relaxed">
          <b className="font-normal" style={{ color: 'rgb(var(--ink-2))' }}>
            Only
          </b>{' '}
          hears one line on its own ·{' '}
          <b className="font-normal" style={{ color: 'rgb(var(--ink-2))' }}>
            Mute
          </b>{' '}
          drops your part so you can play it
        </p>
      </section>

      {!simpleMode && (
        <section>
          <button
            className="lbl mb-1.5 flex w-full items-center gap-1 underline decoration-rule2"
            onClick={() => setShowScoreOpts((v) => !v)}
            aria-expanded={showScoreOpts}
          >
            Whole score {showScoreOpts ? '−' : '+'}
          </button>
          {showScoreOpts && (
            <>
              {(
                [
                  ['Transpose', 'transpose', -12, 12, 1] as const,
                  ['Room', 'reverb', 0, 0.85, 0.01] as const,
                  ['Swing', 'swing', 0, 1, 0.02] as const,
                  ['Human', 'humanize', 0, 1, 0.02] as const,
                ]
              ).map(([label, key, min, max, step]) => (
                <div key={key} className="flex items-center gap-2 py-0.5">
                  <span className="lbl w-16">{label}</span>
                  <input
                    type="range"
                    className="rng flex-1"
                    min={min}
                    max={max}
                    step={step}
                    value={transport[key] as number}
                    onChange={(e) => patch({ [key]: Number(e.target.value) })}
                    aria-label={label}
                  />
                  <span className="num w-8 text-[11px]">
                    {key === 'transpose'
                      ? (transport.transpose > 0 ? '+' : '') + transport.transpose
                      : Math.round((transport[key] as number) * 100)}
                  </span>
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
