/**
 * Recording yourself against the score.
 *
 * Practising without hearing yourself back is guesswork — almost everyone
 * rushes, drags or plays flat in ways they cannot hear while concentrating on
 * the notes. Playing a take back *with* the score running is the single most
 * useful thing a practice tool can do, and it costs nothing to build: the
 * microphone is already open for pitch scoring.
 *
 * Takes stay in memory for the session. They are deliberately not persisted —
 * a recording of someone practising is private, and quietly filling their disk
 * with it is not a decision to make on their behalf.
 */

export interface Take {
  id: string;
  blob: Blob;
  url: string;
  /** Quarter-note position in the score where recording began. */
  startQ: number;
  seconds: number;
  bpm: number;
  createdAt: number;
  /** Peak levels for the waveform, one per ~50 ms. */
  peaks: number[];
}

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

export class TakeRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private peaks: number[] = [];
  private peakTimer: number | null = null;
  private startedAt = 0;

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Live input level, for the meter. */
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }

  async start(startQ: number, bpm: number): Promise<void> {
    if (this.recording) return;
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('This browser cannot record audio.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);

    this.chunks = [];
    this.peaks = [];
    this.startedAt = performance.now();
    this.pendingStartQ = startQ;
    this.pendingBpm = bpm;

    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start(200);

    // Sample the level regularly so the take has a waveform to show.
    this.peakTimer = window.setInterval(() => this.peaks.push(this.level()), 50);
  }

  private pendingStartQ = 0;
  private pendingBpm = 96;

  async stop(): Promise<Take | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      this.cleanup();
      return null;
    }

    const finished = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
    });
    recorder.stop();
    const blob = await finished;
    const seconds = (performance.now() - this.startedAt) / 1000;
    const peaks = [...this.peaks];
    this.cleanup();

    if (blob.size < 512) return null;
    return {
      id: `take-${Date.now().toString(36)}`,
      blob,
      url: URL.createObjectURL(blob),
      startQ: this.pendingStartQ,
      seconds,
      bpm: this.pendingBpm,
      createdAt: Date.now(),
      peaks,
    };
  }

  private cleanup() {
    if (this.peakTimer != null) {
      clearInterval(this.peakTimer);
      this.peakTimer = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.recorder = null;
    this.chunks = [];
  }

  dispose() {
    this.cleanup();
  }
}

/** Normalised peaks, so a quiet take still draws a readable waveform. */
export function normalisePeaks(peaks: number[], buckets = 120): number[] {
  if (!peaks.length) return [];
  const max = Math.max(...peaks, 0.0001);
  const out: number[] = [];
  const size = Math.max(1, Math.floor(peaks.length / buckets));
  for (let i = 0; i < peaks.length; i += size) {
    const slice = peaks.slice(i, i + size);
    out.push(Math.max(...slice) / max);
  }
  return out;
}
