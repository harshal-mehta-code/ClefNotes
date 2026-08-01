import { useApp } from '../../state/store';
import { inkVar, midiName } from '../../lib/score/types';
import { instrumentsByFamily, SOUND_PACKS } from '../../lib/audio/instruments';
import { VOICE_PRESETS } from '../../lib/audio/clefvox';
import { Chip, Label } from '../ui/primitives';

export default function Mixer() {
  const score = useApp((s) => s.score);
  const mixes = useApp((s) => s.mixes);
  const setMix = useApp((s) => s.setMix);
  const soloOnly = useApp((s) => s.soloOnly);
  const minusOne = useApp((s) => s.minusOne);
  const applySoundPack = useApp((s) => s.applySoundPack);
  const packId = useApp((s) => s.packId);
  const transport = useApp((s) => s.transport);
  const patch = useApp((s) => s.patchTransport);

  if (!score) return null;
  const anySolo = mixes.some((m) => m.solo);
  const families = instrumentsByFamily();

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <section>
        <Label className="mb-2">Sound pack</Label>
        <div className="flex flex-wrap gap-1.5">
          {SOUND_PACKS.map((p) => (
            <Chip key={p.id} on={packId === p.id} onClick={() => applySoundPack(p)} title={p.blurb}>
              {p.name}
            </Chip>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Label>Parts · {score.parts.length}</Label>
          {anySolo && (
            <button className="lbl ml-auto underline decoration-riso-pink" onClick={() => soloOnly(null)}>
              clear solo
            </button>
          )}
        </div>

        <div className="flex flex-col">
          {score.parts.map((part, i) => {
            const mix = mixes[i];
            if (!mix) return null;
            const audible = anySolo ? mix.solo : !mix.muted;
            return (
              <div key={i} className="border-b border-rule py-2.5 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="h-6 w-[5px] shrink-0" style={{ background: inkVar(i) }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-[13px] font-bold leading-tight tracking-tight">
                      {part.name}
                    </div>
                    <div className="lbl truncate">
                      {midiName(part.lowMidi)}–{midiName(part.highMidi)}
                      {part.hasLyrics && ' · lyrics'}
                    </div>
                  </div>
                  <button
                    className={`mini-btn ${mix.solo ? 'is-solo' : ''}`}
                    onClick={() => setMix(i, { solo: !mix.solo })}
                    aria-pressed={mix.solo}
                    title="Solo this part"
                  >
                    S
                  </button>
                  <button
                    className={`mini-btn ${mix.muted ? 'is-mute' : ''}`}
                    onClick={() => setMix(i, { muted: !mix.muted })}
                    aria-pressed={mix.muted}
                    title="Mute this part"
                  >
                    M
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-2">
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

                <div className="mt-2 flex items-center gap-2">
                  <span className="lbl w-6">VOL</span>
                  <input
                    type="range"
                    className="rng flex-1"
                    min={0}
                    max={1}
                    step={0.01}
                    value={mix.volume}
                    onChange={(e) => setMix(i, { volume: Number(e.target.value) })}
                    aria-label={`Volume for ${part.name}`}
                    style={{ opacity: audible ? 1 : 0.4 }}
                  />
                  <span className="num w-8 text-[10px] text-ink3">{Math.round(mix.volume * 100)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="lbl w-6">PAN</span>
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
                    {mix.pan === 0 ? 'C' : mix.pan < 0 ? `L${Math.round(-mix.pan * 9)}` : `R${Math.round(mix.pan * 9)}`}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip onClick={() => soloOnly(i)} title="Hear only this part">
                    Learn this part
                  </Chip>
                  <Chip
                    on={mix.muted && !anySolo}
                    onClick={() => minusOne(i)}
                    title="Mute this part and play it yourself over the ensemble"
                  >
                    Minus-one
                  </Chip>
                  <Chip
                    onClick={() => setMix(i, { transpose: mix.transpose === 0 ? -12 : mix.transpose === -12 ? 12 : 0 })}
                    on={mix.transpose !== 0}
                    title="Shift this part by an octave"
                  >
                    {mix.transpose === 0 ? '8ve' : mix.transpose > 0 ? '+8ve' : '−8ve'}
                  </Chip>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <Label className="mb-2">Score</Label>
        <div className="flex items-center gap-2 py-1">
          <span className="lbl w-16">Transpose</span>
          <input
            type="range"
            className="rng flex-1"
            min={-12}
            max={12}
            step={1}
            value={transport.transpose}
            onChange={(e) => patch({ transpose: Number(e.target.value) })}
            aria-label="Transpose the whole score"
          />
          <span className="num w-8 text-[11px]">
            {transport.transpose > 0 ? `+${transport.transpose}` : transport.transpose}
          </span>
        </div>
        <div className="flex items-center gap-2 py-1">
          <span className="lbl w-16">Room</span>
          <input
            type="range"
            className="rng flex-1"
            min={0}
            max={0.85}
            step={0.01}
            value={transport.reverb}
            onChange={(e) => patch({ reverb: Number(e.target.value) })}
            aria-label="Reverb amount"
          />
          <span className="num w-8 text-[11px]">{Math.round(transport.reverb * 100)}</span>
        </div>
        <div className="flex items-center gap-2 py-1">
          <span className="lbl w-16">Swing</span>
          <input
            type="range"
            className="rng flex-1"
            min={0}
            max={1}
            step={0.02}
            value={transport.swing}
            onChange={(e) => patch({ swing: Number(e.target.value) })}
            aria-label="Swing amount"
          />
          <span className="num w-8 text-[11px]">{Math.round(transport.swing * 100)}</span>
        </div>
        <div className="flex items-center gap-2 py-1">
          <span className="lbl w-16">Human</span>
          <input
            type="range"
            className="rng flex-1"
            min={0}
            max={1}
            step={0.02}
            value={transport.humanize}
            onChange={(e) => patch({ humanize: Number(e.target.value) })}
            aria-label="Humanise timing and dynamics"
          />
          <span className="num w-8 text-[11px]">{Math.round(transport.humanize * 100)}</span>
        </div>
      </section>
    </div>
  );
}
