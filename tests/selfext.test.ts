import { describe, it, expect } from 'vitest';
import { scanPatch } from '../electron/selfext/scanner';
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
