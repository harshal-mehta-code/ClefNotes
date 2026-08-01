import type { PartMix } from '../audio/engine';

/**
 * Share links.
 *
 * With no server there is nowhere to upload a score to, so the score travels
 * *inside* the link: gzipped, base64url-encoded, in the URL fragment. Fragments
 * are never sent to the server, so even on a host that logs everything, a
 * shared score stays between the people holding the link.
 *
 * A choral movement compresses to roughly 6–12 KB of URL, which every current
 * browser handles. Anything larger is refused with a suggestion rather than
 * producing a link that silently truncates.
 */

const MAX_URL = 30000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export interface SharePayload {
  v: 1;
  title: string;
  composer: string;
  musicXml: string;
  /** Mixer state, so a shared link arrives sounding the way you set it up. */
  mixes?: PartMix[];
  bpm?: number;
  loop?: [number, number] | null;
}

export async function encodeShareLink(payload: SharePayload, base = location.href): Promise<string> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('This browser cannot build share links. Export the MusicXML and send that instead.');
  }
  const packed = toBase64Url(await gzip(JSON.stringify(payload)));
  const url = new URL(base);
  url.hash = `s=${packed}`;
  url.search = '';
  const href = url.toString();
  if (href.length > MAX_URL) {
    throw new Error(
      `This score is too large to fit in a link (${Math.round(href.length / 1024)} KB). Export it as MusicXML and share the file instead.`,
    );
  }
  return href;
}

/** Read a shared score out of the current URL, if there is one. */
export async function readShareLink(hash = location.hash): Promise<SharePayload | null> {
  const match = /[#&]s=([A-Za-z0-9_-]+)/.exec(hash);
  if (!match) return null;
  try {
    const json = await gunzip(fromBase64Url(match[1]));
    const payload = JSON.parse(json) as SharePayload;
    if (payload?.v !== 1 || typeof payload.musicXml !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

export function clearShareHash() {
  if (location.hash.includes('s=')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}
