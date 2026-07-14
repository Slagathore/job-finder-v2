import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ────────────────────────────────────────────────────────────────────────
// Regression: a self-extension rollback must not overwrite newer code.
//
// The bug: rollbackProposal() read a backup manifest and blindly copyFile()'d
// the pre-patch content back over whatever is in the tree now, or rm()'d any
// path the patch had created. Backups live in userData and proposal rows live
// in the DB, so both outlive the code they were taken against — the "Roll back"
// button stayed live for a patch applied against an older app version, against
// files a later patch or a later release had legitimately changed.
//
// These tests drive the real applyProposal()/rollbackProposal() with a fake
// `electron` (temp app root + temp userData) and a fake proposal store, so the
// manifest is produced and consumed exactly as it is in the app.
// ────────────────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  appRoot: '' as string,
  userData: '' as string,
  appVersion: '1.0.1',
  proposals: new Map<number, any>(),
  statuses: new Map<number, string>(),
  tempDirs: [] as string[],
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => mockState.appRoot,
    getPath: (_n: string) => mockState.userData,
    getVersion: () => mockState.appVersion,
  },
}));

vi.mock('../electron/selfext/store', () => ({
  getProposal: (id: number) => mockState.proposals.get(id) ?? null,
  setStatus: (id: number, s: string) => { mockState.statuses.set(id, s); },
}));

vi.mock('../electron/agent/audit', () => ({ appendAudit: () => {} }));

import { applyProposal, rollbackProposal } from '../electron/selfext/apply';

const read = (p: string) => fs.readFileSync(p, 'utf8');

/** A tree with one existing file; the patch replaces it and creates a new one. */
function seed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-rollback-'));
  mockState.tempDirs.push(dir);
  mockState.appRoot = path.join(dir, 'app');
  mockState.userData = path.join(dir, 'userData');
  fs.mkdirSync(path.join(mockState.appRoot, 'src'), { recursive: true });
  fs.mkdirSync(mockState.userData, { recursive: true });
  fs.writeFileSync(path.join(mockState.appRoot, 'src', 'old.ts'), 'export const v = 1;\n');

  mockState.proposals.set(1, {
    id: 1,
    patch: {
      id: 'p1', rationale: 'test',
      files: [
        { path: 'src/old.ts', mode: 'replace', contents: 'export const v = 2;\n' },
        { path: 'src/new.ts', mode: 'create', contents: 'export const n = 1;\n' },
      ],
    },
  });
  return {
    old: path.join(mockState.appRoot, 'src', 'old.ts'),
    created: path.join(mockState.appRoot, 'src', 'new.ts'),
    manifest: path.join(mockState.userData, 'selfext-backups', '1', 'manifest.json'),
  };
}

beforeEach(() => {
  mockState.appVersion = '1.0.1';
  mockState.proposals.clear();
  mockState.statuses.clear();
});

afterAll(() => {
  for (const d of mockState.tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('applyProposal', () => {
  it('applies the patch and stamps the backup with the app version + post-patch hashes', async () => {
    const f = seed();
    const r = await applyProposal(1);
    expect(r.ok).toBe(true);
    expect(read(f.old)).toBe('export const v = 2;\n');
    expect(read(f.created)).toBe('export const n = 1;\n');

    const m = JSON.parse(read(f.manifest));
    expect(m.manifestVersion).toBe(2);
    expect(m.appVersion).toBe('1.0.1');
    // Identity of what the rollback is allowed to restore against.
    expect(m.entries.find((e: any) => e.path === 'src/old.ts').postHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.entries.find((e: any) => e.path === 'src/new.ts').action).toBe('delete');
  });
});

describe('rollbackProposal', () => {
  it('restores the pre-patch tree when nothing moved underneath it', async () => {
    const f = seed();
    await applyProposal(1);

    const r = await rollbackProposal(1);
    expect(r.ok).toBe(true);
    expect(read(f.old)).toBe('export const v = 1;\n');       // original content back
    expect(fs.existsSync(f.created)).toBe(false);            // file the patch created is gone
    expect(mockState.statuses.get(1)).toBe('rolled_back');
  });

  // THE BUG. Without the fix this copies the stale pre-patch content over the
  // newer file and reports ok.
  it('REFUSES when a patched file changed after the patch was applied', async () => {
    const f = seed();
    await applyProposal(1);
    fs.writeFileSync(f.old, 'export const v = 3; // a later release rewrote this\n');

    const r = await rollbackProposal(1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/has changed since the patch was applied/i);
    expect(read(f.old)).toBe('export const v = 3; // a later release rewrote this\n'); // untouched
    expect(mockState.statuses.get(1)).toBe('applied');   // not marked rolled_back
  });

  // THE OTHER HALF OF THE BUG: the 'delete' branch rm()'d any path the patch
  // had created — including a file a later version legitimately put there.
  it('REFUSES to delete a created path whose content is no longer the one the patch wrote', async () => {
    const f = seed();
    await applyProposal(1);
    fs.writeFileSync(f.created, 'export const n = 99; // rewritten by a later version\n');

    const r = await rollbackProposal(1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/has changed since the patch was applied/i);
    expect(fs.existsSync(f.created)).toBe(true);   // NOT deleted
    expect(read(f.created)).toContain('99');
  });

  it('REFUSES when the app version moved since the backup was taken', async () => {
    const f = seed();
    await applyProposal(1);
    mockState.appVersion = '1.1.0';   // the user updated the app

    const r = await rollbackProposal(1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/applied against app version 1\.0\.1.*version 1\.1\.0/is);
    expect(read(f.old)).toBe('export const v = 2;\n');   // nothing restored
    expect(fs.existsSync(f.created)).toBe(true);
  });

  it('REFUSES a legacy (v1) manifest, which carries no version or hashes', async () => {
    const f = seed();
    await applyProposal(1);
    // Exactly what the old code wrote: a bare array, no identity at all.
    fs.writeFileSync(f.manifest, JSON.stringify([
      { path: 'src/old.ts', action: 'restore' },
      { path: 'src/new.ts', action: 'delete' },
    ]));

    const r = await rollbackProposal(1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/before rollback safety checks existed/i);
    expect(read(f.old)).toBe('export const v = 2;\n');
    expect(fs.existsSync(f.created)).toBe(true);
  });

  it('REFUSES when a file the patch created was deleted by someone else', async () => {
    const f = seed();
    await applyProposal(1);
    fs.rmSync(f.created);

    const r = await rollbackProposal(1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no longer exists/i);
  });
});
