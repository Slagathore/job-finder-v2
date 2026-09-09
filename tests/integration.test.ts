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
import {
  listConversations, createConversation, getConversation, appendMessage, saveResults,
  saveStepResult, deleteConversation, historyFor,
} from '../electron/agent/conversations';
import { insertItemsDeduped } from '../electron/experience/store';
import { correctHostileBoards } from '../electron/ipc/boards';

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

describe('agent conversations (electron/agent/conversations.ts) - real sqlite persistence', () => {
  beforeEach(freshDb);

  it('titles a new conversation from the first message and lists it', () => {
    const id = createConversation('agent', 'scan all boards then discover my best fits');
    appendMessage(id, { role: 'user', content: 'scan all boards then discover my best fits' });
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].title).toContain('scan all boards');
    expect(list[0].mode).toBe('agent');
    expect(list[0].message_count).toBe(1);
  });

  it('lists newest first by last activity', () => {
    const a = createConversation('agent', 'first thread');
    const b = createConversation('interview', 'second thread');
    // Newest-first is by LAST ACTIVITY, so a turn on the older thread lifts it
    // above the newer one. Real turns are seconds apart; the clock is pushed
    // forward here so the assertion does not hinge on same-millisecond writes.
    const realNow = Date.now;
    Date.now = () => realNow() + 5_000;
    try {
      appendMessage(a, { role: 'user', content: 'a newer turn' });
    } finally {
      Date.now = realNow;
    }
    const list = listConversations();
    expect(list.map(c => c.id)).toEqual([a, b]);
    expect(list.find(c => c.id === b)!.mode).toBe('interview');
  });

  it('redraws a plan and its step results after a restart', () => {
    const id = createConversation('agent', 'scan the boards');
    appendMessage(id, { role: 'user', content: 'scan the boards' });
    const plan = { summary: 'scan', steps: [{ tool: 'scanBoards', args: {} }, { tool: 'openTab', args: { tab: 'search' } }] };
    const mid = appendMessage(id, { role: 'assistant', content: 'scan', plan });
    saveResults(mid, [
      { tool: 'scanBoards', ok: false, needsConfirm: true, summary: 'awaiting your confirmation (harvest)', args: {} },
      { tool: 'openTab', ok: true, summary: 'open search', openTab: 'search' },
    ]);
    saveStepResult(mid, 0, { tool: 'scanBoards', ok: true, summary: '+3 new' });

    // Close and reopen the same on-disk database: an app restart.
    closeDb();
    initDb();

    const conv = getConversation(id)!;
    expect(conv.title).toContain('scan the boards');
    expect(conv.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(conv.messages[1].plan.steps[0].tool).toBe('scanBoards');
    expect(conv.messages[1].results![0]).toMatchObject({ tool: 'scanBoards', ok: true, summary: '+3 new' });
    expect(conv.messages[1].results![1]).toMatchObject({ tool: 'openTab', openTab: 'search' });
  });

  it('ignores an out of range step index instead of corrupting the row', () => {
    const id = createConversation('agent', 'x');
    const mid = appendMessage(id, { role: 'assistant', content: 'x' });
    saveResults(mid, [{ tool: 'note', ok: true, summary: 'hi' }]);
    saveStepResult(mid, 5, { tool: 'evil', ok: true, summary: 'nope' });
    expect(getConversation(id)!.messages[0].results).toHaveLength(1);
  });

  it('bounds the history sent to the model to the last few turns', () => {
    const id = createConversation('agent', 'turn 0');
    for (let i = 0; i < 20; i++) {
      appendMessage(id, { role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}` });
    }
    const h = historyFor(id);
    expect(h).toHaveLength(6);
    expect(h[0].content).toBe('turn 14');
    expect(h[5].content).toBe('turn 19');
    expect(getConversation(id)!.messages).toHaveLength(20);
  });

  it('drops empty turns out of the model history', () => {
    const id = createConversation('agent', 'hello');
    appendMessage(id, { role: 'user', content: 'hello' });
    appendMessage(id, { role: 'assistant', content: '   ' });
    expect(historyFor(id).map(m => m.content)).toEqual(['hello']);
  });

  it('deletes a conversation and its messages', () => {
    const id = createConversation('agent', 'temporary');
    appendMessage(id, { role: 'user', content: 'temporary' });
    deleteConversation(id);
    expect(getConversation(id)).toBeNull();
    expect(listConversations()).toHaveLength(0);
    expect((getDb().prepare('SELECT COUNT(*) n FROM agent_messages').get() as any).n).toBe(0);
  });
});

describe('insertItemsDeduped supersedeSourceRef (electron/experience/store.ts) — real sqlite', () => {
  beforeEach(freshDb);

  it('a repeat digest of the same project replaces its previous pass instead of duplicating it', () => {
    insertItemsDeduped(
      [{ kind: 'project', text: 'Built a medium-pass summary of sporespore.', source_ref: 'github:Slagathore/sporespore' } as any],
      { supersedeSourceRef: 'github:Slagathore/sporespore' }
    );
    insertItemsDeduped(
      [{ kind: 'project', text: 'Built a much richer deep-dive summary of sporespore.', source_ref: 'github:Slagathore/sporespore' } as any],
      { supersedeSourceRef: 'github:Slagathore/sporespore' }
    );

    const rows = getDb().prepare(
      "SELECT text, source_ref FROM experience_items WHERE kind = 'project'"
    ).all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Built a much richer deep-dive summary of sporespore.');
  });

  it('does NOT delete an item that merged with other provenance (a pipe-joined source_ref)', () => {
    // A resume bullet lands first.
    insertItemsDeduped([{
      kind: 'accomplishment', text: 'Shipped a full-stack meta tracker for a trading card game.',
      source_ref: 'resume:pasted',
    } as any]);
    // A repo digest for the same project comes in with near-identical wording and merges
    // into that row, so its source_ref becomes pipe-joined (resume ref + repo ref).
    insertItemsDeduped(
      [{
        kind: 'accomplishment', text: 'Shipped a full-stack meta tracker for a trading card game with a Discord bot.',
        source_ref: 'github:Slagathore/sporespore',
      } as any],
      { supersedeSourceRef: 'github:Slagathore/sporespore' }
    );
    const merged = getDb().prepare(
      "SELECT id, source_ref FROM experience_items WHERE kind = 'accomplishment'"
    ).get() as any;
    expect(merged.source_ref).toContain('github:Slagathore/sporespore');
    expect(merged.source_ref.split('|').length).toBeGreaterThan(1);

    // Re-digesting the SAME repo again must not destroy that merged row, since it
    // still carries the resume's provenance too, not just the repo's.
    insertItemsDeduped(
      [{ kind: 'project', text: 'Unrelated new project-kind item from the re-digest.' } as any],
      { supersedeSourceRef: 'github:Slagathore/sporespore' }
    );
    const stillThere = getDb().prepare('SELECT id FROM experience_items WHERE id = ?').get(merged.id);
    expect(stillThere).toBeTruthy();
  });

  it('a failed insert inside the batch rolls back the delete too (all or nothing)', () => {
    insertItemsDeduped(
      [{ kind: 'project', text: 'Original pass.', source_ref: 'github:Slagathore/sporespore' } as any],
      { supersedeSourceRef: 'github:Slagathore/sporespore' }
    );
    // kind is NOT NULL in the schema; omitting it makes the second row's insert
    // throw partway through the batch.
    expect(() => insertItemsDeduped(
      [{ text: 'Missing its kind, so this insert throws.' } as any],
      { supersedeSourceRef: 'github:Slagathore/sporespore' }
    )).toThrow();

    // The whole transaction (delete + inserts) must have rolled back, so the
    // original pass is still there rather than the user ending up with neither.
    const rows = getDb().prepare("SELECT text FROM experience_items WHERE kind = 'project'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Original pass.');
  });
});

describe('correctHostileBoards (electron/ipc/boards.ts) — real sqlite', () => {
  beforeEach(freshDb);

  it('fixes an existing row already sitting in the bad needs-adapter/stale state', () => {
    const now = Date.now();
    const info = getDb().prepare(
      `INSERT INTO boards (name, type, url, enabled, ingress, status, adapter_stale, created_at)
       VALUES ('indeed', 'ats', 'www.indeed.com', 1, 'dom', 'needs-adapter', 1, ?)`
    ).run(now);
    const id = Number(info.lastInsertRowid);

    const fixed = correctHostileBoards();

    expect(fixed).toBe(1);
    const row = getDb().prepare('SELECT ingress, status, adapter_stale FROM boards WHERE id = ?').get(id) as any;
    expect(row.ingress).toBe('extension');
    expect(row.status).toBe('harvested-by-extension');
    expect(row.adapter_stale).toBe(0);
  });

  it('leaves an ordinary ATS board untouched', () => {
    const now = Date.now();
    const info = getDb().prepare(
      `INSERT INTO boards (name, type, url, enabled, ingress, status, created_at)
       VALUES ('Acme', 'ats', 'https://boards.greenhouse.io/acme', 1, 'api', 'greenhouse', ?)`
    ).run(now);
    const id = Number(info.lastInsertRowid);

    expect(correctHostileBoards()).toBe(0);
    const row = getDb().prepare('SELECT ingress, status FROM boards WHERE id = ?').get(id) as any;
    expect(row.ingress).toBe('api');
    expect(row.status).toBe('greenhouse');
  });
});
