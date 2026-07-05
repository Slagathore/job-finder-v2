import { spawn, type SpawnOptions, type ChildProcess } from 'child_process';

export interface RunResult { ok: boolean; code: number | null; stdout: string; stderr: string; durationMs: number; }

/** Live child processes (sandbox npm runs) — killed on hard shutdown so nothing
 *  is orphaned. */
const activeChildren = new Set<ChildProcess>();
export function killAllChildren(): void {
  for (const c of activeChildren) { try { c.kill('SIGKILL'); } catch { /* */ } }
  activeChildren.clear();
}

/** Run a command (no shell) and capture output. Ported from claw-deck. */
export function run(cmd: string, args: string[], opts: SpawnOptions & { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(cmd, args, { ...opts, shell: false });
    activeChildren.add(child);
    let out = '', err = '', killed = false;
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) timer = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch { /* */ } }, opts.timeoutMs);
    child.stdout?.on('data', d => { out += d.toString(); });
    child.stderr?.on('data', d => { err += d.toString(); });
    child.on('error', e => { if (timer) clearTimeout(timer); activeChildren.delete(child); resolve({ ok: false, code: null, stdout: out, stderr: err + String(e), durationMs: Date.now() - started }); });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      activeChildren.delete(child);
      resolve({ ok: code === 0 && !killed, code, stdout: out, stderr: err + (killed ? '\n[killed: timeout]' : ''), durationMs: Date.now() - started });
    });
  });
}
