/**
 * Local folder reading for project ingestion. Same budget as the GitHub deep
 * dive (see filter.ts), just against the filesystem instead of the REST API.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DEEP_MAX_CANDIDATES, DEEP_MAX_FILE_BYTES, MANIFEST_NAMES, README_NAMES,
  isManifest, isSkippedDir, isSkippedFile, looksBinaryContent, pickSourceFiles,
  type SourceFile, type WalkFile,
} from './filter';

/** Walk a folder into repo-relative {path,size}, honouring the skip rules. */
export function walkFolder(root: string, maxCandidates = DEEP_MAX_CANDIDATES): WalkFile[] {
  const out: WalkFile[] = [];
  const queue: string[] = [''];
  while (queue.length && out.length < maxCandidates) {
    const rel = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (out.length >= maxCandidates) break;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!isSkippedDir(e.name)) queue.push(childRel);
        continue;
      }
      if (!e.isFile() || isSkippedFile(e.name)) continue;
      let size = 0;
      try { size = fs.statSync(path.join(root, childRel)).size; } catch { continue; }
      out.push({ path: childRel, size });
    }
  }
  return out;
}

/** Read the head of one file as text, or null when it is missing or binary. */
export function readTextHead(root: string, rel: string, maxBytes = DEEP_MAX_FILE_BYTES): string | null {
  try {
    const buf = fs.readFileSync(path.join(root, rel));
    const text = buf.subarray(0, maxBytes).toString('utf8');
    return looksBinaryContent(text) ? null : text;
  } catch { return null; }
}

export function readFolderReadme(root: string): string | null {
  for (const name of README_NAMES) {
    const text = readTextHead(root, name, 40_000);
    if (text && text.trim()) return text;
  }
  return null;
}

export function readFolderManifest(root: string): { name: string; content: string } | null {
  let names: string[] = [];
  try { names = fs.readdirSync(root); } catch { return null; }
  const present = names.filter(n => isManifest(n));
  const ordered = [
    ...MANIFEST_NAMES.filter(n => present.includes(n)),
    ...present.filter(n => !MANIFEST_NAMES.includes(n)),
  ];
  for (const name of ordered.slice(0, 3)) {
    const content = readTextHead(root, name, 20_000);
    if (content && content.trim()) return { name, content };
  }
  return null;
}

/** Top level entries, directories marked with a trailing slash. */
export function topLevelEntries(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .map(e => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
  } catch { return []; }
}

/** The ranked, budgeted source read for a local folder. */
export function readFolderSource(root: string): SourceFile[] {
  const picks = pickSourceFiles(walkFolder(root));
  const out: SourceFile[] = [];
  for (const p of picks) {
    const text = readTextHead(root, p.path);
    if (text) out.push({ path: p.path, text });
  }
  return out;
}

/** Rough language mix from file extensions, so a folder gets a breakdown too. */
export function languageMix(files: WalkFile[]): Record<string, number> {
  const byExt: Record<string, number> = {};
  const NAMES: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
    cjs: 'JavaScript', py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin',
    cs: 'C#', cpp: 'C++', cc: 'C++', c: 'C', h: 'C', hpp: 'C++', rb: 'Ruby', php: 'PHP',
    swift: 'Swift', scala: 'Scala', ex: 'Elixir', exs: 'Elixir', dart: 'Dart', lua: 'Lua',
    sh: 'Shell', ps1: 'PowerShell', sql: 'SQL', vue: 'Vue', svelte: 'Svelte', css: 'CSS',
    scss: 'CSS', html: 'HTML', md: 'Markdown',
  };
  for (const f of files) {
    const e = (f.path.split('.').pop() ?? '').toLowerCase();
    const lang = NAMES[e];
    if (!lang) continue;
    byExt[lang] = (byExt[lang] ?? 0) + (f.size || 1);
  }
  return byExt;
}
