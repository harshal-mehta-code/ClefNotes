import { useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../lib/audio/engine';
import { phonetics, VOICE_PRESETS, VOWELS, type VoiceTypeId } from '../../lib/audio/clefvox';
import { inkVar } from '../../lib/score/types';
import { Chip, Label, Panel } from '../ui/primitives';
import Karaoke from '../studio/Karaoke';

/**
 * ClefVox.
 *
 * Choirs pay for "learning tracks" — recordings where your voice is loud and
 * the other three are quiet, so you can learn your line in context. This
 * generates them from the score, for nothing, in a click.
 */
export default function VoxPanel() {
  const score = useApp((s) => s.score);
  const mixes = useApp((s) => s.mixes);
  const setMix = useApp((s) => s.setMix);
  const setAllMixes = useApp((s) => s.setAllMixes);
  const setView = useApp((s) => s.setView);
  const play = useApp((s) => s.play);
  const [demoSyllable, setDemoSyllable] = useState('night');

  const lyricParts = useMemo(() => (score?.parts ?? []).filter((p) => p.hasLyrics), [score]);

  if (!score) {
    return (
      <div className="mx-auto max-w-[900px] px-5 py-16 text-center">
        <h1 className="font-display text-[30px] font-extrabold tracking-tight">Nothing open yet</h1>
        <p className="mt-2 text-ink2">Open a score with lyrics and ClefVox will sing it.</p>
        <button className="btn btn-primary mt-4" onClick={() => setView('library')}>
          Go to the library
        </button>
      </div>
    );
  }

  /** Your part sings the words; the rest drop back to a soft hum. */
  const makeLearningTrack = (index: number) => {
    const next = mixes.map((m, i) => ({
      ...m,
      instrument: (i === index ? 'voice' : 'choir') as typeof m.instrument,
      volume: i === index ? 1 : 0.34,
      muted: false,
      solo: false,
      pan: i === index ? 0 : (i - index) * 0.22,
    }));
    setAllMixes(next);
  };

  const allSing = () => {
    setAllMixes(
      mixes.map((m) => ({ ...m, instrument: 'voice' as typeof m.instrument, volume: 0.85, muted: false, solo: false })),
    );
  };

  const ph = phonetics(demoSyllable);
  const vowel = VOWELS[ph.vowel] ?? VOWELS['ʌ'];

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-5 py-7">
      <header>
        <div className="lbl mb-1.5">ClefVox</div>
        <h1 className="font-display text-[34px] font-extrabold leading-none tracking-[-0.035em]">
          Make the score sing
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-snug text-ink2">
          Every vowel is three resonances stacked on a pitch — so ClefNotes builds them directly,
          in your browser, with no model to download and nothing to pay for. It sounds synthetic on
          purpose. A rehearsal track should sound like a guide, not a performance.
        </p>
      </header>

      {lyricParts.length === 0 && (
        <div className="border-l-4 border-warn bg-panel px-4 py-3">
          <div className="lbl mb-1" style={{ color: 'rgb(var(--warn))' }}>
            No lyrics in this score
          </div>
          <p className="text-[14.5px] leading-snug text-ink2">
            ClefVox can still sing it on an "ah" — pick the ClefVox sound pack in the Studio mixer.
            For words, import a score that carries lyrics (most choral MusicXML does).
          </p>
        </div>
      )}

      {/* min-w-0 on both columns: without it the horizontally scrolling lyric
          strip inside stretches the grid track instead of scrolling. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Learning tracks">
            <p className="mb-3 max-w-[58ch] text-[14px] leading-snug text-ink2">
              Pick your part. It sings the words at full volume; the others stay underneath so you
              can hear how your line fits.
            </p>
            <div className="flex flex-col gap-2">
              {score.parts.map((part, i) => {
                const mix = mixes[i];
                const isLead = mix?.instrument === 'voice' && mix.volume > 0.8;
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 border-b border-rule pb-2 last:border-b-0">
                    <span className="h-6 w-[5px] shrink-0" style={{ background: inkVar(i) }} />
                    <span className="min-w-[110px] font-display text-[13.5px] font-bold tracking-tight">
                      {part.name}
                    </span>
                    <select
                      className="field"
                      value={mix?.voiceType ?? 'alto'}
                      onChange={(e) => setMix(i, { voiceType: e.target.value as VoiceTypeId })}
                      aria-label={`Voice type for ${part.name}`}
                    >
                      {Object.values(VOICE_PRESETS).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    <Chip on={isLead} onClick={() => makeLearningTrack(i)}>
                      {isLead ? 'Leading' : 'Make this my part'}
                    </Chip>
                    <button
                      className="btn btn-ghost"
                      onClick={() => void engine.preview(part.medianMidi, i, 1.1, 'la')}
                      title="Hear this voice"
                    >
                      ♪
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => void play()}>
                ▶ Play the track
              </button>
              <button className="btn" onClick={allSing}>
                Everyone sings
              </button>
              <button className="btn btn-ghost" onClick={() => setView('studio')}>
                Open in Studio →
              </button>
            </div>
          </Panel>

          <Panel title="Words as ClefVox hears them">
            <Karaoke showVowels />
            <p className="lbl mt-2 leading-relaxed">
              The small symbol under each syllable is the vowel being sung. English spelling is
              irregular, so this is a rule, not a dictionary — an odd-sounding word usually means a
              vowel guessed wrong, never a wrong note.
            </p>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Try a syllable">
            <input
              className="field w-full"
              value={demoSyllable}
              onChange={(e) => setDemoSyllable(e.target.value)}
              placeholder="Type a word…"
              aria-label="Syllable to audition"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['night', 'glo-', 'peace', 'joy', 'sanc-', 'tus', 'hal', 'le'].map((w) => (
                <Chip key={w} on={demoSyllable === w} onClick={() => setDemoSyllable(w)}>
                  {w}
                </Chip>
              ))}
            </div>

            <div className="mt-3">
              <Label className="mb-1.5">Vowel · {ph.vowel}</Label>
              <svg viewBox="0 0 300 90" className="w-full" aria-label="Formant peaks for this vowel">
                <line x1="6" y1="84" x2="294" y2="84" stroke="rgb(var(--rule))" />
                {vowel.f.map((f, i) => {
                  const x = 8 + (Math.log2(Math.max(200, f) / 200) / Math.log2(4000 / 200)) * 280;
                  const h = 12 + vowel.a[i] * 62;
                  return (
                    <g key={i}>
                      <rect
                        x={x - 5}
                        y={84 - h}
                        width={10}
                        height={h}
                        fill="rgb(var(--violet))"
                        opacity={0.35 + vowel.a[i] * 0.6}
                      />
                      <text
                        x={x}
                        y={84 - h - 4}
                        textAnchor="middle"
                        fontSize="8"
                        fontFamily="ui-monospace, monospace"
                        fill="rgb(var(--ink-3))"
                      >
                        F{i + 1}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="lbl mt-1">
                {vowel.f.map((f) => `${Math.round(f)} Hz`).join(' · ')}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(Object.keys(VOICE_PRESETS) as VoiceTypeId[]).map((v) => (
                <button
                  key={v}
                  className="chip"
                  onClick={() => {
                    const preset = VOICE_PRESETS[v];
                    const ctx = engine.audioContext;
                    void (async () => {
                      const audio = await engine.ensureContext();
                      const { sing } = await import('../../lib/audio/clefvox');
                      sing(audio, audio.destination, {
                        freq: v === 'bass' ? 130 : v === 'tenor' ? 196 : v === 'soprano' ? 392 : 262,
                        when: (ctx ?? audio).currentTime + 0.03,
                        duration: 1.3,
                        syllable: demoSyllable,
                        preset,
                      });
                    })();
                  }}
                >
                  {VOICE_PRESETS[v].name}
                </button>
              ))}
            </div>
            <p className="lbl mt-2 leading-relaxed">Tap a voice to hear it sing that syllable.</p>
          </Panel>

          <Panel title="How it works">
            <ol className="ml-4 list-decimal text-[13.5px] leading-relaxed text-ink2 marker:font-mono marker:text-[10px] marker:text-ink3">
              <li>The syllable's spelling is mapped to a vowel.</li>
              <li>That vowel sets three formant frequencies — the resonances of a vocal tract.</li>
              <li>A glottal pulse train sounds at the note's pitch.</li>
              <li>Three bandpass filters shape it into the vowel.</li>
              <li>Consonants arrive as short noise bursts; vibrato and breath sit on top.</li>
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
