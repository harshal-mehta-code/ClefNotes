import { useApp } from '../../state/store';
import { KEY_CHOICES, setKeySignature, setTimeSignature } from '../../lib/score/edit';

/**
 * The two things recognition can't read.
 *
 * A key signature is a handful of small marks between the clef and the time
 * signature, and getting it wrong silently mis-pitches every note of that
 * letter for the whole piece — so ClefNotes doesn't guess. You know your key;
 * one tap applies it to the notation and to the playback at once.
 *
 * Only shown on recognised scores, where it is the highest-value correction
 * available.
 */
export default function RecognitionBar() {
  const score = useApp((s) => s.score);
  const applyScoreEdit = useApp((s) => s.applyScoreEdit);
  const loading = useApp((s) => s.loading);

  if (!score || score.source !== 'omr') return null;

  const currentFifths = (() => {
    const m = /<fifths>(-?\d+)<\/fifths>/.exec(score.musicXml);
    return m ? Number(m[1]) : 0;
  })();

  return (
    <div className="flex flex-wrap items-center gap-2 border-t-[1.5px] border-ink bg-panel2 px-3 py-2">
      <span className="lbl" style={{ color: 'rgb(var(--warn))' }}>
        Recognised — check it
      </span>

      <div className="flex items-center gap-1.5">
        <span className="lbl">Key</span>
        <select
          className="field"
          value={currentFifths}
          disabled={loading}
          onChange={(e) => void applyScoreEdit((xml) => setKeySignature(xml, Number(e.target.value)))}
          aria-label="Key signature"
        >
          {KEY_CHOICES.map((k) => (
            <option key={k.fifths} value={k.fifths}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="lbl">Time</span>
        <select
          className="field"
          value={`${score.beatsPerBar}/${score.beatUnit}`}
          disabled={loading}
          onChange={(e) => {
            const [b, t] = e.target.value.split('/').map(Number);
            void applyScoreEdit((xml) => setTimeSignature(xml, b, t));
          }}
          aria-label="Time signature"
        >
          {['4/4', '3/4', '2/4', '2/2', '6/8', '9/8', '12/8', '5/4'].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <span className="lbl ml-auto hidden sm:block">
        Recognition can't read these — set them once and the notes follow
      </span>
    </div>
  );
}
