import * as path from 'path';
import * as fsp from 'fs/promises';

export interface FilePatch { path: string; mode: 'create' | 'replace' | 'delete'; contents?: string; }
export interface PatchSet { id: string; rationale: string; files: FilePatch[]; }

// These are SAFETY guards (don't escape the repo / corrupt git or deps), NOT a
// feature denylist — per Cole's decision the agent may edit any app file.
const FORBIDDEN_SEGMENTS = ['..', '.git', 'node_modules'];

export function validatePatchSet(set: PatchSet, root: string): { ok: boolean; reason?: string } {
  if (!set || !Array.isArray(set.files) || set.files.length === 0) return { ok: false, reason: 'empty patch set' };
  const rootAbs = path.resolve(root);
  for (const f of set.files) {
    if (typeof f.path !== 'string' || !f.path) return { ok: false, reason: 'missing file path' };
    if (path.isAbsolute(f.path)) return { ok: false, reason: `absolute path: ${f.path}` };
    const norm = path.posix.normalize(f.path.replace(/\\/g, '/'));
    if (norm.startsWith('../') || norm === '..') return { ok: false, reason: `escapes root: ${f.path}` };
    for (const p of norm.split('/')) if (FORBIDDEN_SEGMENTS.includes(p)) return { ok: false, reason: `forbidden segment "${p}": ${f.path}` };
    const abs = path.resolve(root, norm);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return { ok: false, reason: `resolves outside root: ${f.path}` };
    if ((f.mode === 'create' || f.mode === 'replace') && typeof f.contents !== 'string') return { ok: false, reason: `missing contents for ${f.path}` };
  }
  return { ok: true };
}

/** Apply a patch set to a tree (used for both the sandbox clone and, after
 *  approval, the live tree). Caller handles backups for the live tree. */
export async function applyPatchSet(set: PatchSet, root: string): Promise<{ changed: string[] }> {
  const v = validatePatchSet(set, root);
  if (!v.ok) throw new Error(`invalid patch: ${v.reason}`);
  const changed: string[] = [];
  for (const f of set.files) {
    const norm = path.posix.normalize(f.path.replace(/\\/g, '/'));
    const abs = path.resolve(root, norm);
    if (f.mode === 'delete') { try { await fsp.rm(abs, { force: true }); changed.push(norm); } catch { /* */ } continue; }
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, f.contents!, 'utf8');
    changed.push(norm);
  }
  return { changed };
}

/** Parse a PatchSet from model output. Uses strict JSON.parse (NO json repair —
 *  repair would mangle code inside file `contents`). */
export function extractPatchSet(text: string): PatchSet | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(body.slice(start, end + 1));
    if (!j || !Array.isArray(j.files)) return null;
    return {
      id: typeof j.id === 'string' ? j.id : `patch-${Date.now().toString(36)}`,
      rationale: typeof j.rationale === 'string' ? j.rationale : '',
      files: j.files,
    };
  } catch { return null; }
}
