import { describe, it, expect } from 'vitest';
import { scanPatch, isSelfExtGuardrailPath } from '../electron/selfext/scanner';
import { extractPatchSet, validatePatchSet } from '../electron/selfext/patcher';

describe('scanPatch (advisory)', () => {
  it('flags eval / child_process / fs-delete with severities', () => {
    const set = { id: 'x', rationale: '', files: [
      { path: 'a.ts', mode: 'create' as const, contents: 'const r = eval(userInput);\nimport cp from "child_process";\nfs.rmSync(p);' },
      { path: 'del.ts', mode: 'delete' as const },
    ] };
    const { findings, counts } = scanPatch(set);
    const rules = findings.map(f => f.rule);
    expect(rules).toContain('eval');
    expect(rules).toContain('child_process');
    expect(rules).toContain('fs-delete');
    expect(counts.high).toBeGreaterThanOrEqual(1);
  });
  it('returns nothing for benign code', () => {
    const set = { id: 'x', rationale: '', files: [{ path: 'a.ts', mode: 'create' as const, contents: 'export const add = (a:number,b:number)=>a+b;' }] };
    expect(scanPatch(set).findings).toHaveLength(0);
  });
});

describe('scanPatch — self-extension guardrail files (H10)', () => {
  it('flags a patch touching the approval gate (electron/ipc/selfext.ts) as high, by path alone', () => {
    // Deliberately benign contents — no eval/child_process/etc — to prove this
    // is caught by PATH, not by the content-pattern rules.
    const set = { id: 'x', rationale: '', files: [
      { path: 'electron/ipc/selfext.ts', mode: 'replace' as const, contents: 'export const add = (a: number, b: number) => a + b;' },
    ] };
    const { findings, counts } = scanPatch(set);
    const hit = findings.find(f => f.file === 'electron/ipc/selfext.ts');
    expect(hit?.rule).toBe('selfext-guardrail-path');
    expect(hit?.severity).toBe('high');
    expect(counts.high).toBeGreaterThanOrEqual(1);
  });

  it('flags any file under electron/selfext/**, including a silent deletion', () => {
    const set = { id: 'x', rationale: '', files: [
      { path: 'electron/selfext/sandbox.ts', mode: 'delete' as const },
    ] };
    const { findings } = scanPatch(set);
    expect(findings.some(f => f.rule === 'selfext-guardrail-path' && f.file === 'electron/selfext/sandbox.ts')).toBe(true);
  });

  it('flags nested paths and backslash-style paths under the guardrail directory', () => {
    expect(isSelfExtGuardrailPath('electron/selfext/deep/nested.ts')).toBe(true);
    expect(isSelfExtGuardrailPath('electron\\selfext\\scanner.ts')).toBe(true);
    expect(isSelfExtGuardrailPath('./electron/ipc/selfext.ts')).toBe(true);
  });

  it('does not flag unrelated app files or lookalike names', () => {
    const set = { id: 'x', rationale: '', files: [
      { path: 'src/tabs/SearchTab.tsx', mode: 'replace' as const, contents: 'export const x = 1;' },
      { path: 'electron/ipc/experience.ts', mode: 'replace' as const, contents: 'export const y = 1;' },
    ] };
    expect(scanPatch(set).findings.some(f => f.rule === 'selfext-guardrail-path')).toBe(false);
    expect(isSelfExtGuardrailPath('electron/ipc/selfext-utils.ts')).toBe(false);
  });
});

describe('extractPatchSet', () => {
  it('parses a fenced patch set with code contents intact', () => {
    const text = 'Here:\n```json\n{"id":"p1","rationale":"add util","files":[{"path":"src/x.ts","mode":"create","contents":"export const x = 1; // ok"}]}\n```';
    const ps = extractPatchSet(text);
    expect(ps?.files[0].path).toBe('src/x.ts');
    expect(ps?.files[0].contents).toContain('// ok'); // comments preserved (no json-repair)
  });
  it('returns null when no json', () => {
    expect(extractPatchSet('no patch here')).toBeNull();
  });
});

describe('validatePatchSet (path safety)', () => {
  const root = process.platform === 'win32' ? 'C:\\app' : '/app';
  it('accepts in-root paths', () => {
    expect(validatePatchSet({ id: 'x', rationale: '', files: [{ path: 'src/a.ts', mode: 'create', contents: 'x' }] }, root).ok).toBe(true);
  });
  it('rejects escapes and forbidden segments', () => {
    expect(validatePatchSet({ id: 'x', rationale: '', files: [{ path: '../evil.ts', mode: 'create', contents: 'x' }] }, root).ok).toBe(false);
    expect(validatePatchSet({ id: 'x', rationale: '', files: [{ path: 'node_modules/x.ts', mode: 'create', contents: 'x' }] }, root).ok).toBe(false);
    expect(validatePatchSet({ id: 'x', rationale: '', files: [{ path: '.git/hooks/x', mode: 'create', contents: 'x' }] }, root).ok).toBe(false);
  });
  it('rejects create/replace without contents', () => {
    expect(validatePatchSet({ id: 'x', rationale: '', files: [{ path: 'a.ts', mode: 'replace' }] as any }, root).ok).toBe(false);
  });
});
