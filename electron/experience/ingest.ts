import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Extract plain text from an ingested source file. PDF via pdf-parse, DOCX via
 * mammoth, everything else read as UTF-8. Loaders are required lazily so a
 * missing optional dep degrades to a clear error rather than crashing boot.
 */
export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    // pdf.js spams "Warning: TT: undefined function" font notes via console — mute
    // them around the parse so the dev log stays clean (text still extracts fine).
    const origLog = console.log, origWarn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try {
      const pdf = require('pdf-parse/lib/pdf-parse.js');
      const buf = await fs.readFile(filePath);
      const out = await pdf(buf);
      return (out.text ?? '').trim();
    } catch (e: any) {
      throw new Error(`PDF parse failed (${path.basename(filePath)}): ${e?.message ?? e}`);
    } finally {
      console.log = origLog; console.warn = origWarn;
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth = require('mammoth');
      const out = await mammoth.extractRawText({ path: filePath });
      return (out.value ?? '').trim();
    } catch (e: any) {
      throw new Error(`DOCX parse failed (${path.basename(filePath)}): ${e?.message ?? e}`);
    }
  }

  // .md, .txt, .json, .rtf-ish, or unknown — best effort as text.
  return (await fs.readFile(filePath, 'utf-8')).trim();
}
