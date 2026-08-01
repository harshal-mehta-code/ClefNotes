import type { Score } from '../score/types';
import { midiToFreq, qToSec } from '../score/types';
import { INSTRUMENTS, noiseBuffer, periodicWave } from './instruments';
import { sing, VOICE_PRESETS } from './clefvox';
import { makeImpulse, type PartMix } from './engine';

/**
 * Offline render to WAV.
 *
 * OfflineAudioContext runs the whole graph faster than real time, so a movement
 * bounces in a second or two — and the file that comes out is exactly what you
 * heard, mix and all.
 */

export async function renderToWav(
  score: Score,
  mixes: PartMix[],
  opts: { bpm: number; transpose: number; reverb: number; sampleRate?: number },
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const sampleRate = opts.sampleRate ?? 44100;
  const tail = 2.8;
  const seconds = qToSec(score.totalQ, opts.bpm) + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 2.2, 2.6);
  wet.gain.value = opts.reverb * 0.9;
  dry.gain.value = 1 - opts.reverb * 0.35;
  dry.connect(master);
  wet.connect(convolver);
  convolver.connect(master);

  const anySolo = mixes.some((m) => m.solo);
  const partNodes = score.parts.map((_, i) => {
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const mix = mixes[i];
    const audible = !mix ? true : anySolo ? mix.solo : !mix.muted;
    gain.gain.value = audible ? (mix?.volume ?? 0.85) : 0;
    pan.pan.value = mix?.pan ?? 0;
    gain.connect(pan);
    pan.connect(dry);
    pan.connect(wet);
    return gain;
  });

  score.notes.forEach((note, index) => {
    const mix = mixes[note.part];
    if (!mix) return;
    if (anySolo ? !mix.solo : mix.muted) return;
    const dest = partNodes[note.part];
    if (!dest) return;

    const when = qToSec(note.q, opts.bpm) + 0.05;
    const preset = INSTRUMENTS[mix.instrument];
    const dur = Math.max(0.06, qToSec(note.qDur, opts.bpm) * (preset.articulation ?? 0.96));
    const midi = note.midi + opts.transpose + mix.transpose;

    if (mix.instrument === 'voice') {
      sing(ctx, dest, {
        freq: midiToFreq(midi),
        when,
        duration: dur,
        syllable: note.syllable,
        preset: VOICE_PRESETS[mix.voiceType] ?? VOICE_PRESETS.alto,
      });
    } else {
      renderVoice(ctx, dest, preset, midiToFreq(midi), when, dur);
    }
    if (index % 200 === 0) onProgress?.((index / score.notes.length) * 0.5);
  });

  onProgress?.(0.55);
  const buffer = await ctx.startRendering();
  onProgress?.(0.9);
  return encodeWav(buffer);
}

/** The same voice construction as the live engine, against an offline context. */
function renderVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  p: (typeof INSTRUMENTS)[keyof typeof INSTRUMENTS],
  freq: number,
  when: number,
  dur: number,
) {
  const amp = ctx.createGain();
  amp.gain.value = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = p.q ?? 0.9;
  amp.connect(filter);
  filter.connect(dest);

  const track = p.keyTrack ?? 0.5;
  const cutoff = Math.min(ctx.sampleRate / 2.2, Math.max(180, p.cutoff * Math.pow(freq / 261.63, track)));
  filter.frequency.setValueAtTime(cutoff, when);
  if (p.filterEnv) {
    filter.frequency.setValueAtTime(Math.min(ctx.sampleRate / 2.2, cutoff * Math.pow(2, p.filterEnv)), when);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, cutoff), when + (p.filterEnvDecay ?? 0.2));
  }

  const wave = periodicWave(ctx, p.partials);
  const unison = p.unison ?? 1;
  for (let u = 0; u < unison; u++) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = freq;
    if (unison > 1) osc.detune.value = (u - (unison - 1) / 2) * (p.detuneCents ?? 8);
    if (p.vibratoDepth && dur > (p.vibratoDelay ?? 0) + 0.12) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = p.vibratoRate ?? 5;
      lg.gain.setValueAtTime(0, when);
      lg.gain.setValueAtTime(0, when + (p.vibratoDelay ?? 0.3));
      lg.gain.linearRampToValueAtTime(p.vibratoDepth, when + (p.vibratoDelay ?? 0.3) + 0.2);
      lfo.connect(lg);
      lg.connect(osc.detune);
      lfo.start(when);
      lfo.stop(when + dur + p.release + 0.1);
    }
    const ug = ctx.createGain();
    ug.gain.value = 1 / Math.sqrt(unison);
    osc.connect(ug);
    ug.connect(amp);
    osc.start(when);
    osc.stop(when + dur + p.release + 0.1);
  }

  if (p.noise) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = Math.min(9000, freq * 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(p.noise, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + (p.noiseDecay ?? 0.05) + 0.01);
    src.connect(hp);
    hp.connect(g);
    g.connect(dest);
    src.start(when);
    src.stop(when + (p.noiseDecay ?? 0.05) + 0.12);
  }

  const peak = p.gain;
  const sustainLevel = Math.max(0.0002, peak * p.sustain);
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(peak, when + p.attack);
  if (p.sustain <= 0.001) {
    amp.gain.exponentialRampToValueAtTime(0.0002, when + p.attack + p.decay);
  } else {
    amp.gain.exponentialRampToValueAtTime(sustainLevel, when + p.attack + p.decay);
    amp.gain.setValueAtTime(sustainLevel, Math.max(when + dur - 0.001, when + p.attack + p.decay));
    amp.gain.exponentialRampToValueAtTime(0.0002, when + dur + p.release);
  }
}

/** 16-bit PCM WAV. */
function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, frames * channels * 2, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
