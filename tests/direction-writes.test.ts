import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Integration cover for the career direction WRITES. The point of this feature
// is that it can change saved searches and role fits, so the thing worth
// proving against a real database is that it only ever adds, never overwrites,
// and that the undo removes exactly what it added. Same electron mock shape as
// tests/integration.test.ts: a temp userData dir and a real SQLite file.

const mockState = vi.hoisted(() => ({ userDataDir: '' as string, tempDirs: [] as string[] }));

vi.mock('electron', () => ({
  app: { getPath: () => mockState.userDataDir, getAppPath: () => process.cwd(), on: () => {}, isPackaged: false },
  ipcMain: { handle: () => {}, removeHandler: () => {}, on: () => {} },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => Buffer.from(b).toString('utf-8'),
  },
}));

import { initDb, getDb, closeDb } from '../electron/ipc/db';
import {
  applyDirectionFits, applyDirectionSearches, getDirection, getIntake,
  previewDirectionFits, previewDirectionSearches, runDirection, saveIntake, undoDirectionWrite,
} from '../electron/career/direction';

const FULL_INTAKE = {
  pay_floor: '$60,000', work_mode: ['remote'], relocate: 'no', manage_people: 'open to it',
  retraining: 'a few months', location: 'Dallas', industries_avoid: 'insurance',
};

const REPORT = {
  summary: 's',
  directions: [{
    title: 'Technical Writer', kind: 'core', fit: 0.8, why: 'docs', evidence: ['wrote the runbook'],
    gaps: [], pay: '', demand: '', next_step: '', titles: ['Technical Writer'], industries: ['software'],
    role_fits: [{ role_family: 'Technical Writer', industry: 'software', confidence: 0.8, rationale: 'docs' }],
  }],
  honest_note: '', adjacency_note: '',
};

function freshDb(): void {
  try { closeDb(); } catch { /* not open yet */ }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-direction-'));
  mockState.tempDirs.push(dir);
  mockState.userDataDir = dir;
  initDb();
}

function seedReport(): void {
  getDb().prepare('INSERT INTO career_direction (report, intake, item_count, created_at) VALUES (?,?,?,?)')
    .run(JSON.stringify(REPORT), '{}', 3, Date.now());
}

beforeEach(() => freshDb());
afterAll(() => {
  try { closeDb(); } catch { /* already closed */ }
  for (const d of mockState.tempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* leave it */ } }
});

describe('preference intake persistence', () => {
  it('round trips the answers and never asks twice', () => {
    expect(getIntake().missing.length).toBeGreaterThan(0);
    const saved = saveIntake(FULL_INTAKE);
    expect(saved.missing).toEqual([]);
    expect(saved.answers.pay_floor).toBe(60000);
    expect(getIntake().answers.work_mode).toEqual(['remote']);
  });
  it('replaces the answers on a revision instead of stacking rows', () => {
    saveIntake(FULL_INTAKE);
    saveIntake({ ...FULL_INTAKE, pay_floor: 80000 });
    expect(getIntake().answers.pay_floor).toBe(80000);
    expect((getDb().prepare('SELECT COUNT(*) n FROM career_intake').get() as any).n).toBe(1);
  });
});

describe('runDirection guards', () => {
  it('refuses to guess before the intake is finished', async () => {
    const r = await runDirection();
    expect(r).toHaveProperty('error');
    expect((r as any).error).toMatch(/preference intake/i);
  });
  it('refuses when there is no experience on file', async () => {
    saveIntake(FULL_INTAKE);
    const r = await runDirection();
    expect((r as any).error).toMatch(/No experience on file/i);
  });
});

describe('saved search writes', () => {
  beforeEach(() => { saveIntake(FULL_INTAKE); seedReport(); });

  it('previews the exact search it would create without writing it', () => {
    const plan = previewDirectionSearches(0) as any;
    expect(plan.name).toBe('Direction: Technical Writer');
    expect(plan.params.payMin).toBe(60000);
    expect(plan.params.workModes).toEqual(['remote']);
    expect((getDb().prepare('SELECT COUNT(*) n FROM saved_searches').get() as any).n).toBe(0);
  });

  it('creates the search, leaves existing ones alone, and undoes only its own row', () => {
    getDb().prepare('INSERT INTO saved_searches (name, params, created_at) VALUES (?,?,?)')
      .run('mine already', '{}', Date.now());
    const first = applyDirectionSearches(0) as any;
    expect(first.created).toHaveLength(1);

    // A second run must not overwrite or delete the first.
    const second = applyDirectionSearches(0) as any;
    expect(second.created[0].name).toBe('Direction: Technical Writer (2)');
    expect((getDb().prepare('SELECT COUNT(*) n FROM saved_searches').get() as any).n).toBe(3);

    const undone = undoDirectionWrite({ searchIds: second.created.map((c: any) => c.id) });
    expect(undone.searchesRemoved).toBe(1);
    const names = (getDb().prepare('SELECT name FROM saved_searches ORDER BY id').all() as any[]).map(r => r.name);
    expect(names).toEqual(['mine already', 'Direction: Technical Writer']);
  });

  it('stores parameters the Search tab can load back', () => {
    applyDirectionSearches(0);
    const row = getDb().prepare('SELECT params FROM saved_searches ORDER BY id DESC LIMIT 1').get() as any;
    const params = JSON.parse(row.params);
    expect(params.roleFamily).toBe('Technical Writer');
    expect(params.excludeKeyword).toBe('insurance');
  });
});

describe('role fit writes', () => {
  beforeEach(() => { saveIntake(FULL_INTAKE); seedReport(); });

  it('appends without touching the fits already on file, and undoes cleanly', () => {
    getDb().prepare('INSERT INTO role_fits (role_family, industry, confidence, refreshed_at) VALUES (?,?,?,?)')
      .run('Operations Analyst', 'logistics', 0.7, Date.now());
    const plan = previewDirectionFits(0) as any;
    expect(plan.additions).toHaveLength(1);
    expect(plan.alreadyPresent).toEqual([]);

    const applied = applyDirectionFits(0) as any;
    expect(applied.added).toHaveLength(1);
    const families = (getDb().prepare('SELECT role_family FROM role_fits ORDER BY id').all() as any[]).map(r => r.role_family);
    expect(families).toEqual(['Operations Analyst', 'Technical Writer']);

    undoDirectionWrite({ fitIds: applied.added.map((a: any) => a.id) });
    expect((getDb().prepare('SELECT COUNT(*) n FROM role_fits').get() as any).n).toBe(1);
  });

  it('does not add a fit that is already there', () => {
    applyDirectionFits(0);
    const second = previewDirectionFits(0) as any;
    expect(second.additions).toEqual([]);
    expect(second.alreadyPresent).toEqual(['Technical Writer']);
    expect((applyDirectionFits(0) as any).added).toEqual([]);
  });
});

describe('report persistence', () => {
  it('survives a restart of the process', () => {
    seedReport();
    expect(getDirection()?.report.directions[0].title).toBe('Technical Writer');
  });
  it('says so plainly when there is no report to act on', () => {
    expect(getDirection()).toBeNull();
    expect(previewDirectionSearches(0)).toHaveProperty('error');
  });
});
