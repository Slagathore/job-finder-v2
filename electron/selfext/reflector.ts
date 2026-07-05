import * as path from 'path';
import * as fsp from 'fs/promises';
import { generate, type ChatMessage } from '../llm/provider';
import { extractPatchSet, type PatchSet } from './patcher';
import type { Settings } from '../ipc/settings';

const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.html']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'dist-installer', 'output', '.cache']);

export interface FileFact { path: string; loc: number; exports: string[]; }

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries: any[];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walk(root, abs, out);
    else if (e.isFile() && TEXT_EXTS.has(path.extname(e.name).toLowerCase())) out.push(abs);
    if (out.length > 1500) return;
  }
}

export async function buildFacts(root: string): Promise<FileFact[]> {
  const files: string[] = [];
  await walk(root, root, files);
  const facts: FileFact[] = [];
  for (const f of files) {
    try {
      const buf = await fsp.readFile(f);
      if (buf.length > 200 * 1024) continue;
      const text = buf.toString('utf8');
      const exports = [...text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|interface|type|enum)\s+([A-Za-z0-9_]+)/g)].map(m => m[1]);
      facts.push({ path: path.relative(root, f).replace(/\\/g, '/'), loc: text.split(/\r?\n/).length, exports: exports.slice(0, 12) });
    } catch { /* ignore */ }
  }
  return facts;
}

export function buildProposalPrompt(facts: FileFact[], instruction: string): ChatMessage[] {
  const inventory = facts.slice(0, 120).map(f => `- ${f.path} (loc=${f.loc})${f.exports.length ? ` exports: ${f.exports.join(',')}` : ''}`).join('\n');
  const system = `You are a senior TypeScript engineer extending an Electron + React + better-sqlite3 desktop app
("Job Finder"). Propose a focused code change that fulfills the user's instruction.

Respond with ONLY a JSON object inside a \`\`\`json fence:
{ "id": "short-slug", "rationale": "what & why (1-3 sentences)",
  "files": [ { "path": "relative/posix/path.ts", "mode": "create"|"replace"|"delete", "contents": "FULL FILE CONTENTS" } ] }

Rules:
- Replace WHOLE files (provide complete contents); never emit diffs.
- Keep the change small and focused; touch as few files as possible.
- Do NOT break the build — match existing patterns (electron main = CommonJS TS in electron/, renderer = React in src/).
- Electron handlers register in electron/main.ts; IPC is bridged in electron/preload.ts and typed in src/types.d.ts.
- Add a Vitest test under tests/ when it makes sense (the sandbox runs lint + tests).
- Output ONLY the JSON fence.`;
  const user = `Instruction: ${instruction}\n\nFile inventory:\n${inventory}\n\nPropose the change.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export async function generateProposal(s: Settings, root: string, instruction: string): Promise<PatchSet | null> {
  const facts = await buildFacts(root);
  const r = await generate(s, buildProposalPrompt(facts, instruction), { temperature: 0.2, maxTokens: 8000 });
  return extractPatchSet(r.text);
}
