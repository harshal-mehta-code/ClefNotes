import { midiToMusicXml } from '../score/midiImport';

/**
 * File sniffing and unpacking.
 *
 * Everything runs in the browser: nothing is uploaded anywhere, which is both
 * the privacy story and the reason there's no server to pay for.
 */

export type ImportKind = 'musicxml' | 'mxl' | 'midi' | 'pdf' | 'abc' | 'unknown';

export function sniff(file: File): ImportKind {
  const name = file.name.toLowerCase();
  if (name.endsWith('.mxl')) return 'mxl';
  if (name.endsWith('.xml') || name.endsWith('.musicxml')) return 'musicxml';
  if (name.endsWith('.mid') || name.endsWith('.midi')) return 'midi';
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.abc')) return 'abc';
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type.includes('xml')) return 'musicxml';
  if (file.type.includes('midi')) return 'midi';
  return 'unknown';
}

/** Minimal ZIP reader — enough to pull the score out of an .mxl container. */
export async function unzipFirstXml(buf: ArrayBuffer): Promise<string> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const entries: Array<{ name: string; offset: number; compressed: number; size: number; method: number }> = [];

  // Walk local file headers rather than the central directory: .mxl files are
  // small and always well-formed enough for this.
  let i = 0;
  while (i < bytes.length - 4) {
    if (view.getUint32(i, true) !== 0x04034b50) break;
    const method = view.getUint16(i + 8, true);
    const compressed = view.getUint32(i + 18, true);
    const size = view.getUint32(i + 22, true);
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const dataStart = i + 30 + nameLen + extraLen;
    entries.push({ name, offset: dataStart, compressed, size, method });
    i = dataStart + compressed;
    if (compressed === 0 && size === 0) break;
  }

  // META-INF/container.xml names the real score; otherwise take the first .xml.
  const pick =
    entries.find((e) => /\.(musicxml|xml)$/i.test(e.name) && !e.name.startsWith('META-INF')) ?? entries[0];
  if (!pick) throw new Error('That .mxl file appears to be empty.');

  const slice = bytes.subarray(pick.offset, pick.offset + pick.compressed);
  if (pick.method === 0) return new TextDecoder().decode(slice);

  // Deflate — DecompressionStream is available in every browser we target.
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unpack .mxl files. Try the uncompressed .musicxml export.');
  }
  const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

export interface ImportResult {
  musicXml: string;
  source: string;
  note?: string;
}

/** Read any supported file into MusicXML. */
export async function readScoreFile(
  file: File,
  onProgress?: (label: string) => void,
): Promise<ImportResult> {
  const kind = sniff(file);

  if (kind === 'musicxml' || kind === 'abc') {
    const text = await file.text();
    return { musicXml: text, source: 'musicxml' };
  }

  if (kind === 'mxl') {
    onProgress?.('Unpacking the compressed score…');
    const xml = await unzipFirstXml(await file.arrayBuffer());
    return { musicXml: xml, source: 'musicxml' };
  }

  if (kind === 'midi') {
    onProgress?.('Converting MIDI to notation…');
    const xml = midiToMusicXml(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ''));
    return {
      musicXml: xml,
      source: 'midi',
      note: 'MIDI has no notation, so beaming and spelling are best guesses. Pitch and rhythm are exact.',
    };
  }

  if (kind === 'pdf') {
    const { importPdf } = await import('./pdf');
    return importPdf(file, onProgress);
  }

  throw new Error(
    `ClefNotes doesn't recognise "${file.name}". Try MusicXML (.musicxml, .xml, .mxl), MIDI, or a PDF.`,
  );
}
