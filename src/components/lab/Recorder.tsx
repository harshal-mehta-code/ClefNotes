import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { engine } from '../../lib/audio/engine';
import { normalisePeaks, TakeRecorder, type Take } from '../../lib/audio/recorder';
import { Label, Meter } from '../ui/primitives';

/**
 * Take recorder.
 *
 * Record yourself over the score, then play the take back *with* the score
 * running so you hear exactly where you rushed or sat under the pitch. Takes
 * live in memory for the session only — a recording of someone practising is
 * private, and filling their disk with it is not a decision to make for them.
 */
export default function Recorder() {
  const score = useApp((s) => s.score);
  const transport = useApp((s) => s.transport);
  const play = useApp((s) => s.play);
  const pause = useApp((s) => s.pause);
  const seekQ = useApp((s) => s.seekQ);

  const recorderRef = useRef<TakeRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    const r = new TakeRecorder();
    recorderRef.current = r;
    return () => {
      r.dispose();
      // Release the object URLs when leaving.
      setTakes((list) => {
        list.forEach((t) => URL.revokeObjectURL(t.url));
        return [];
      });
    };
  }, []);

  // Live input meter while armed.
  useEffect(() => {
    if (!busy) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      setLevel(recorderRef.current?.level() ?? 0);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [busy]);

  const start = async () => {
    setError(null);
    try {
      const from = engine.getState().q;
      await recorderRef.current?.start(from, Math.round(transport.bpm * transport.rate));
      setBusy(true);
      // The score starts with the recording, so the take and the bars line up.
      if (!transport.playing) await play();
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone access was declined, so there is nothing to record.'
          : 'Recording is not available in this browser.',
      );
    }
  };

  const stop = async () => {
    setBusy(false);
    const take = await recorderRef.current?.stop();
    pause();
    if (take) setTakes((list) => [take, ...list].slice(0, 6));
  };

  /** Play a take with the score running underneath it, from the same bar. */
  const playTake = async (take: Take) => {
    if (playingId === take.id) {
      audioRef.current?.pause();
      pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    seekQ(take.startQ);
    const audio = new Audio(take.url);
    audioRef.current = audio;
    audio.onended = () => {
      setPlayingId(null);
      pause();
    };
    setPlayingId(take.id);
    await audio.play();
    await play();
  };

  if (!score) return null;

  return (
    <div>
      <p className="mb-3 max-w-[58ch] text-[14px] leading-snug text-ink2">
        Record yourself over the score, then hear the take back with the score playing underneath.
        Almost everyone rushes somewhere they can't hear while they're concentrating.
      </p>

      {error && <p className="mb-2 text-[13px] leading-snug text-crit">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {busy ? (
          <button className="btn" style={{ background: 'rgb(var(--crit))', color: '#fff' }} onClick={() => void stop()}>
            ■ Stop recording
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void start()}>
            ● Record a take
          </button>
        )}
        {busy && (
          <div className="flex min-w-[140px] flex-1 items-center gap-2">
            <span className="lbl">Input</span>
            <div className="flex-1">
              <Meter value={level * 4} tone={level > 0.28 ? 'rgb(var(--crit))' : 'rgb(var(--ok))'} />
            </div>
          </div>
        )}
      </div>

      {takes.length > 0 && (
        <div className="mt-4">
          <Label className="mb-2">Takes · this session</Label>
          <div className="flex flex-col gap-2">
            {takes.map((take, i) => {
              const peaks = normalisePeaks(take.peaks, 90);
              const bar = score.measureQ.size
                ? (Array.from(score.measureQ.entries()).find(
                    ([, m]) => take.startQ >= m.start && take.startQ < m.start + m.length,
                  )?.[0] ?? 1)
                : 1;
              return (
                <div key={take.id} className="flex items-center gap-2 border border-rule2 p-2">
                  <button
                    className={`btn ${playingId === take.id ? 'btn-on' : ''}`}
                    onClick={() => void playTake(take)}
                  >
                    {playingId === take.id ? '❚❚' : '▶'}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="lbl mb-1">
                      Take {takes.length - i} · from bar {bar} · {take.bpm} BPM · {take.seconds.toFixed(1)}s
                    </div>
                    <div className="flex h-6 items-end gap-[1px]">
                      {peaks.map((p, k) => (
                        <span
                          key={k}
                          className="flex-1"
                          style={{
                            height: `${Math.max(6, p * 100)}%`,
                            background: playingId === take.id ? 'rgb(var(--pink))' : 'rgb(var(--rule-2))',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <a className="btn btn-ghost" href={take.url} download={`take-${takes.length - i}.webm`}>
                    Save
                  </a>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      URL.revokeObjectURL(take.url);
                      setTakes((list) => list.filter((t) => t.id !== take.id));
                    }}
                    title="Discard this take"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <p className="lbl mt-2 leading-relaxed">
            Takes are kept in memory only — they disappear when you leave. Save any you want to keep.
          </p>
        </div>
      )}
    </div>
  );
}
