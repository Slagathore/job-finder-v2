import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ────────────────────────────────────────────────────────────────────────
// Integration harness for the Electron main-process code.
//
// The unit suite (tests/*.test.ts) only exercises pure functions (parsing,
// rendering, url-normalisation, ...). It never touches a real database or a
// real IPC handler, which is exactly how a real bug slipped through: the
// apply flow could mark a job "applied" before the apply window opened,
// because nothing ever drove gateApplication/markApplied against a real
// SQLite db. These tests do that: real better-sqlite3, real schema (via
// initDb()), real ipcMain.handle() registration, invoked end-to-end.
//
// `electron` is mocked BEFORE any electron/ module is imported (vi.mock is
// hoisted by Vitest above the imports below). `vi.hoisted()` gives the mock
// factory access to shared, mutable state: a channel->handler map so tests
// can invoke registered IPC handlers directly, and a per-test temp
// "userData" directory so every test gets an isolated on-disk database.
//
// RUNTIME NOTE: this file loads the real better-sqlite3 native binding.
// `postinstall` (electron-builder install-app-deps) rebuilds that binding
// against Electron's Node ABI, not the system Node used by a plain
// `npx vitest run` — so on a dev box where system Node != Electron's Node
// version, `npx vitest run tests/integration.test.ts` fails with a
// NODE_MODULE_VERSION mismatch (pre-existing env condition, not a bug in
// this file — every other *.test.ts avoids it by staying pure/DB-free).
// Run it through Electron's own Node runtime instead, e.g. on Windows:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe ./node_modules/vitest/vitest.mjs run
// ────────────────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: any[]) => any>(),
  userDataDir: '' as string,
  tempDirs: [] as string[],
}));

vi.mock('electron', () => {
  class NoOp {
    constructor(..._args: any[]) {}
    destroy() {}
    setToolTip() {}
    setContextMenu() {}
    on() {}
    loadFile() { return Promise.resolve(); }
  }
  return {
    app: {
      getPath: (_name: string) => mockState.userDataDir,
      getAppPath: () => process.cwd(),
      on: () => {},
      whenReady: () => Promise.resolve(),
      quit: () => {},
      isPackaged: false,
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: any[]) => any) => { mockState.ipcHandlers.set(channel, fn); },
      removeHandler: (channel: string) => { mockState.ipcHandlers.delete(channel); },
      on: () => {},
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s, 'utf-8'),
      decryptString: (b: Buffer) => Buffer.from(b).toString('utf-8'),
    },
    BrowserWindow: NoOp,
    Notification: NoOp,
    Tray: NoOp,
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {} },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({}), createEmpty: () => ({}) },
  };
});

// checkLiveness performs a real network fetch (electron/boards/fetch-html).
// Stub the whole module so apply-flow tests are deterministic and offline;
// classifyLiveness (pure) is already covered by tests/applyflow.test.ts.
vi.mock('../electron/apply/liveness', () => ({
  checkLiveness: vi.fn(async () => ({ live: true, reason: 'live' })),
  classifyLiveness: vi.fn(),
}));

import { initDb, getDb, closeDb } from '../electron/ipc/db';
import { ingestJobs } from '../electron/ingest/jobs';
import { gateApplication, markApplied } from '../electron/apply/batch';
import { checkLiveness } from '../electron/apply/liveness';
import { registerBlocklistHandlers } from '../electron/ipc/blocklist';
import { registerSelfExtHandlers } from '../electron/ipc/selfext';
import { saveProposal, setSandboxResult } from '../electron/selfext/store';
import type { PatchSet } from '../electron/selfext/patcher';

/** Close whatever db is open, point app.getPath('userData') at a fresh temp
 *  dir, and re-run initDb() — every test gets its own real, isolated
 *  SQLite database with the full production schema. */
function freshDb(): void {
  try { closeDb(); } catch { /* not yet open */ }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-integration-'));
  mockState.tempDirs.push(dir);
  mockState.userDataDir = dir;
  initDb();
}

let seq = 0;
function insertJob(overrides: Partial<{ url: string; company: string; title: string }> = {}): number {
  seq++;
  const now = Date.now();
  const info = getDb().prepare(
    `INSERT INTO jobs (source, url, company, title, first_seen, status)
     VALUES ('extension', @url, @company, @title, @now, 'discovered')`
  ).run({
    url: overrides.url ?? `https://acme.com/job/${seq}`,
    company: overrides.company ?? 'Acme',
    title: overrides.title ?? 'Engineer',
    now,
  });
  return Number(info.lastInsertRowid);
}

afterAll(() => {
  try { closeDb(); } catch { /* noop */ }
  for (const dir of mockState.tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

beforeEach(() => {
  freshDb();
  mockState.ipcHandlers.clear();
  vi.mocked(checkLiveness).mockReset();
  vi.mocked(checkLiveness).mockResolvedValue({ live: true, reason: 'live' });
});

describe('ingestJobs (electron/ingest/jobs.ts) — real sqlite dedup/enrich behavior', () => {
  it('inserts a new job with status "discovered" and captures salary into salary_listed', () => {
    const res = ingestJobs([{ title: 'Engineer', url: 'https://x.com/job/1', company: 'Acme', salary: '$100k' }]);
    expect(res).toEqual({ added: 1, duplicates: 0, skipped: 0, updated: 0 });

    const row = getDb().prepare('SELECT status, salary_listed FROM jobs WHERE url = ?').get('https://x.com/job/1') as any;
    expect(row.status).toBe('discovered');
    expect(row.salary_listed).toBe('$100k');
  });

  it('dedups by normalized url — utm/tracking params are stripped before comparing', () => {
    ingestJobs([{ title: 'Engineer', url: 'https://x.com/job/1?utm_source=indeed' }]);
    const res = ingestJobs([{ title: 'Engineer', url: 'https://x.com/job/1?utm_source=linkedin&utm_medium=email' }]);

    expect(res).toMatchObject({ added: 0, duplicates: 1 });
    const count = (getDb().prepare('SELECT COUNT(*) as c FROM jobs').get() as any).c;
    expect(count).toBe(1);
  });

  it('a duplicate url carrying a description ENRICHES the existing row and nulls its embedding', () => {
    ingestJobs([{ title: 'Engineer', url: 'https://x.com/job/2' }]);
    getDb().prepare('UPDATE jobs SET embedding = ? WHERE url = ?').run(Buffer.from('stale-vector'), 'https://x.com/job/2');

    const res = ingestJobs([{ title: 'Engineer', url: 'https://x.com/job/2', description: 'Full JD text here' }]);
    expect(res).toMatchObject({ added: 0, duplicates: 0, updated: 1 });

    const row = getDb().prepare('SELECT description, embedding FROM jobs WHERE url = ?').get('https://x.com/job/2') as any;
    expect(row.description).toBe('Full JD text here');
    expect(row.embedding).toBeNull();
  });

  it('a duplicate url with NO description is just counted as a duplicate (no enrich)', () => {
    ingestJobs([{ title: 'Engineer', url: 'https://x.com/job/3' }]);
    const res = ingestJobs([{ title: 'Engineer', url: 'https://x.com/job/3' }]);

    expect(res).toMatchObject({ added: 0, duplicates: 1, updated: 0 });
    const row = getDb().prepare('SELECT description FROM jobs WHERE url = ?').get('https://x.com/job/3') as any;
    expect(row.description).toBeNull();
  });

  it('skips rows with no title or no resolvable url', () => {
    const res = ingestJobs([{ title: '', url: 'https://x.com/job/4' }, { title: 'No URL', url: '' }]);
    expect(res).toEqual({ added: 0, duplicates: 0, skipped: 2, updated: 0 });
  });
});

describe('apply flow (electron/apply/batch.ts) — the "applied before the window opened" regression', () => {
  it('gateApplication returns ok for a live job and performs NO db writes', async () => {
    vi.mocked(checkLiveness).mockResolvedValueOnce({ live: true, reason: 'live' });
    const jobId = insertJob();

    const result = await gateApplication(jobId);

    expect(result.ok).toBe(true);
    const job = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as any;
    expect(job.status).toBe('discovered'); // NOT flipped to 'applied' by the gate
    const appCount = (getDb().prepare('SELECT COUNT(*) as c FROM applications WHERE job_id = ?').get(jobId) as any).c;
    expect(appCount).toBe(0); // gate never creates an applications row
  });

  it('gateApplication refuses a posting that is no longer live, without writing to the db', async () => {
    vi.mocked(checkLiveness).mockResolvedValueOnce({ live: false, reason: 'closed/expired' });
    const jobId = insertJob();

    const result = await gateApplication(jobId);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/closed/);
    const job = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as any;
    expect(job.status).toBe('discovered');
  });

  it('gateApplication refuses a job that does not exist', async () => {
    const result = await gateApplication(999999);
    expect(result).toEqual({ ok: false, reason: 'job not found' });
  });

  it('gate refuses a blocklisted company (blocklisted via the real blocklist:add IPC handler)', async () => {
    registerBlocklistHandlers();
    const addHandler = mockState.ipcHandlers.get('blocklist:add')!;
    await addHandler({}, { name: 'Blocked Co', reason: 'scam reports' });

    const jobId = insertJob({ company: 'Blocked Co Inc' }); // normalizeCompany strips the "Inc"
    const result = await gateApplication(jobId);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/blocklist/);
  });

  it('markApplied creates the applications row (state=applied) and flips job status', () => {
    const jobId = insertJob();

    markApplied(jobId);

    const job = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as any;
    expect(job.status).toBe('applied');
    const application = getDb().prepare('SELECT state FROM applications WHERE job_id = ?').get(jobId) as any;
    expect(application.state).toBe('applied');
  });

  it('markApplied is idempotent — a second call updates the same row instead of inserting another', () => {
    const jobId = insertJob();
    markApplied(jobId);
    markApplied(jobId);

    const count = (getDb().prepare('SELECT COUNT(*) as c FROM applications WHERE job_id = ?').get(jobId) as any).c;
    expect(count).toBe(1);
  });
});

describe('selfext approve gate (electron/ipc/selfext.ts) — a patch must pass sandbox before touching the live tree', () => {
  beforeEach(() => {
    registerSelfExtHandlers();
  });

  function proposal(): PatchSet {
    return { id: 'p1', rationale: 'test change', files: [] };
  }

  it('refuses to approve when no sandbox result exists yet', async () => {
    const id = saveProposal(proposal(), { findings: [], counts: {} });
    const approve = mockState.ipcHandlers.get('selfext:approve')!;

    const result = await approve({}, id);

    expect(result.error).toMatch(/Sandbox/);
  });

  it('still refuses after a FAILING sandbox result', async () => {
    const id = saveProposal(proposal(), { findings: [], counts: {} });
    setSandboxResult(id, { ok: false, stage: 'test', output: 'tests failed', durationMs: 42 });
    const approve = mockState.ipcHandlers.get('selfext:approve')!;

    const result = await approve({}, id);

    expect(result.error).toMatch(/Sandbox/);
  });

  it('errors cleanly for an unknown proposal id (does not throw)', async () => {
    const approve = mockState.ipcHandlers.get('selfext:approve')!;
    const result = await approve({}, 999999);
    expect(result.error).toMatch(/not found/i);
  });
});
