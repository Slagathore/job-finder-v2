import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';
import { run } from './exec';
import { applyPatchSet, type PatchSet } from './patcher';

export interface SandboxResult { ok: boolean; stage: string; output: string; durationMs: number; }

const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'dist-installer', 'output', '.cache']);

async function clone(src: string, dst: string): Promise<void> {
  await fsp.mkdir(dst, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await clone(s, d);
    else if (e.isFile()) await fsp.copyFile(s, d);
  }
}

/**
 * Stage the patch in an isolated copy and run lint + tests there. The live tree
 * is never executed. node_modules is reused via a junction (full reinstall would
 * dominate runtime). The patched code only runs HERE — applying to the live tree
 * still requires explicit user approval afterward.
 */
export async function runInSandbox(root: string, set: PatchSet, timeoutMs = 600_000): Promise<SandboxResult> {
  const started = Date.now();
  const tmp = path.join(os.tmpdir(), `jobfinder-sandbox-${Date.now().toString(36)}`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    await clone(root, tmp);
    try { await fsp.symlink(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'junction'); }
    catch {
      const ci = await run(npm, ['ci', '--no-audit', '--no-fund'], { cwd: tmp, timeoutMs: 300_000 });
      if (!ci.ok) return { ok: false, stage: 'npm ci', output: (ci.stdout + ci.stderr).slice(-4000), durationMs: Date.now() - started };
    }
    await applyPatchSet(set, tmp);

    const lint = await run(npm, ['run', 'lint'], { cwd: tmp, timeoutMs });
    if (!lint.ok) return { ok: false, stage: 'lint (tsc)', output: (lint.stdout + lint.stderr).slice(-6000), durationMs: Date.now() - started };

    const test = await run(npm, ['test', '--silent'], { cwd: tmp, timeoutMs });
    return { ok: test.ok, stage: test.ok ? 'passed' : 'tests', output: (test.stdout + test.stderr).slice(-6000), durationMs: Date.now() - started };
  } catch (e: any) {
    return { ok: false, stage: 'sandbox', output: e?.message ?? String(e), durationMs: Date.now() - started };
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => { /* best effort */ });
  }
}
