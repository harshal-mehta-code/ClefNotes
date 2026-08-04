/**
 * Look at what the reader saw.
 *
 * Runs the real detector — the same modules the app ships — over a PDF, and
 * writes out a picture of every page with each detected notehead ringed on it,
 * plus the raw numbers. Nothing here is part of the app; it exists so that a
 * change to recognition can be judged against pages rather than against a
 * feeling, and so a fix for one score can be checked against the others before
 * it is called a fix.
 *
 *   node scripts/detect.mjs score.pdf [more.pdf ...]
 *
 * Output lands in .detect/<name>/page-N.png and .detect/<name>/reading.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const inputs = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!inputs.length) {
  console.error('Pass one or more PDFs: node scripts/detect.mjs score.pdf');
  process.exit(2);
}

const server = await createServer({ server: { port: 5199 }, logLevel: 'warn' });
await server.listen();
const base = `http://localhost:5199`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(base, { waitUntil: 'networkidle' });

const outRoot = path.resolve('.detect');
fs.mkdirSync(outRoot, { recursive: true });

for (const input of inputs) {
  const name = path.basename(input).replace(/\.pdf$/i, '');
  const bytes = fs.readFileSync(input).toString('base64');
  console.log(`\n=== ${name}`);

  const result = await page.evaluate(async (b64) => {
    const { readPdf } = await import('/scripts/harness.ts');
    return readPdf(b64);
  }, bytes);

  const dir = path.join(outRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const summary = [];
  for (const p of result) {
    fs.writeFileSync(
      path.join(dir, `page-${p.index + 1}.png`),
      Buffer.from(p.png.split(',')[1], 'base64'),
    );
    summary.push({ index: p.index, bands: p.bands, staves: p.staves, notes: p.notes });
    const hollow = p.notes.filter((n) => !n.filled).length;
    console.log(
      `page ${p.index + 1}: ${p.ms}ms, ${p.staves.length} staves, ${p.notes.length} notes ` +
        `[${p.vector == null ? "pixels" : "glyphs " + p.vector}] ` +
        `(${hollow} hollow, ${p.notes.length - hollow} filled)`,
    );
  }
  fs.writeFileSync(path.join(dir, 'reading.json'), JSON.stringify(summary, null, 2));
}

await browser.close();
await server.close();
