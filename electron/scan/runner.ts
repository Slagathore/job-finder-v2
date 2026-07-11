import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { buildTitleFilter, inferWorkMode, pool, type Offer } from './ats';
import { scanOneBoard } from './scan-board';
import { isWatched } from '../ipc/watch';
import { addNotification } from '../ipc/notifications';

export interface ScanSummary {
  scanned: number;
  found: number;
  filteredTitle: number;
  duplicates: number;
  added: number;
  errors: { company: string; error: string }[];
  added_jobs: { company: string; title: string; location: string; source: string }[];
}

interface BoardRow { id: number; name: string; url: string; enabled: number; ingress: string | null; }

let scanRunning = false;
export function scanBusy(): boolean { return scanRunning; }

/**
 * Run an ATS scan over all enabled boards and persist new jobs.
 * Pure ATS detection/parsing lives in ats.ts; this is the side-effecting shell:
 * load boards → fetch → title-filter → dedup → insert → log.
 * The reentrancy lock lives HERE so every entry point shares it — IPC,
 * scheduler tick, tray "Scan now", and the agent all call this function.
 */
export async function runScan(trigger: 'manual' | 'scheduled' | 'agent' = 'manual'): Promise<ScanSummary> {
  if (scanRunning) throw new Error('A scan is already running.');
  scanRunning = true;
  try {
    return await doScan(trigger);
  } finally {
    scanRunning = false;
  }
}

async function doScan(trigger: 'manual' | 'scheduled' | 'agent'): Promise<ScanSummary> {
  const db = getDb();
  const settings = readSettings();
  const titleFilter = buildTitleFilter({
    positive: settings.titleFilterPositive ?? [],
    negative: settings.titleFilterNegative ?? [],
  });

  const boards = db.prepare('SELECT id, name, url, enabled, ingress FROM boards WHERE enabled = 1').all() as BoardRow[];

  // Dedup set: existing job URLs + scan history.
  const seen = new Set<string>();
  for (const r of db.prepare('SELECT url FROM jobs').all() as { url: string }[]) if (r.url) seen.add(r.url);
  for (const r of db.prepare('SELECT url FROM scan_history').all() as { url: string }[]) if (r.url) seen.add(r.url);

  const summary: ScanSummary = {
    scanned: 0, found: 0, filteredTitle: 0, duplicates: 0, added: 0,
    errors: [], added_jobs: [],
  };
  const newOffers: Offer[] = [];

  await pool(boards, 8, async (board) => {
    try {
      const offers = await scanOneBoard({ name: board.name, url: board.url });
      summary.scanned++;
      summary.found += offers.length;
      // Auto-learning scraper repair: flag a DOM adapter that returned nothing.
      if (board.ingress === 'dom') db.prepare('UPDATE boards SET adapter_stale = ? WHERE id = ?').run(offers.length === 0 ? 1 : 0, board.id);
      for (const o of offers) {
        if (!o.url || !o.title) continue;
        if (!titleFilter(o.title)) { summary.filteredTitle++; continue; }
        if (seen.has(o.url)) { summary.duplicates++; continue; }
        seen.add(o.url);
        newOffers.push(o);
      }
    } catch (e: any) {
      summary.errors.push({ company: board.name, error: e?.message ?? String(e) });
    }
  });

  // Persist within a single transaction.
  const now = Date.now();
  const insertJob = db.prepare(`
    INSERT INTO jobs (source, url, company, title, location_raw, work_mode, first_seen, status)
    VALUES (@source, @url, @company, @title, @location_raw, @work_mode, @first_seen, 'discovered')
    ON CONFLICT(url) DO NOTHING
  `);
  const insertHist = db.prepare(`
    INSERT INTO scan_history (url, first_seen, portal, title, company, status)
    VALUES (?, ?, ?, ?, ?, 'added')
  `);

  const tx = db.transaction((offers: Offer[]) => {
    for (const o of offers) {
      const res = insertJob.run({
        source: o.source, url: o.url, company: o.company, title: o.title,
        location_raw: o.location, work_mode: o.workMode ?? inferWorkMode(o.location), first_seen: now,
      });
      if (res.changes > 0) {
        summary.added++;
        summary.added_jobs.push({ company: o.company, title: o.title, location: o.location, source: o.source });
        insertHist.run(o.url, now, o.source, o.title, o.company);
      } else {
        summary.duplicates++;
      }
    }
    db.prepare('INSERT INTO runs (ts, kind, trigger, summary, result) VALUES (?, ?, ?, ?, ?)')
      .run(now, 'scan', trigger,
        `${summary.added} added / ${summary.found} found across ${summary.scanned} boards`,
        JSON.stringify({ ...summary, added_jobs: undefined }));
  });
  tx(newOffers);

  // Company-watch radar: ping when a watched company posts something new.
  for (const j of summary.added_jobs) {
    try { if (isWatched(j.company)) addNotification('watch', { company: j.company, title: j.title }); } catch { /* */ }
  }

  return summary;
}
