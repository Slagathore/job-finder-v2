import { getDb } from '../ipc/db';
import { isBlocked } from '../ipc/blocklist';
import { normalizeCompany } from '../lib/company';

/**
 * Indeed→ATS bridge (the "seed source" idea): companies that arrive via the
 * browser extension are probed for a public Greenhouse / Lever / Ashby job
 * board. A hit gets auto-added to the boards table, turning one scraped Indeed
 * job into a durable, zero-cost API feed of EVERY job at that company — and a
 * direct-ATS apply URL instead of Indeed's middleman flow.
 *
 * Politeness: a handful of companies per run, ≤3 slug guesses × 3 ATS vendors
 * per company, results (hits AND misses) cached; misses retried after 90 days.
 */

const FETCH_TIMEOUT_MS = 6_000;
const RETRY_MISS_AFTER_MS = 90 * 24 * 3600_000;

export interface DiscoveredBoard { company: string; ats: string; boardUrl: string; }

/** Candidate ATS slugs for a company name, most likely first. */
export function slugsFor(company: string): string[] {
  const norm = normalizeCompany(company);
  if (!norm) return [];
  const words = norm.split(' ').filter(Boolean);
  const joined = words.join('');
  const hyphen = words.join('-');
  const out = [joined, hyphen, words[0]]
    .filter(s => s && s.length >= 3)
    .map(s => s.replace(/[^a-z0-9-]/g, ''));
  return [...new Set(out)].slice(0, 3);
}

interface AtsProbe { type: string; api: (slug: string) => string; board: (slug: string) => string; hasJobs: (json: any) => boolean; }

const ATS: AtsProbe[] = [
  {
    type: 'greenhouse',
    api: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    board: s => `https://boards.greenhouse.io/${s}`,
    hasJobs: j => Array.isArray(j?.jobs),
  },
  {
    type: 'lever',
    api: s => `https://api.lever.co/v0/postings/${s}?limit=1`,
    board: s => `https://jobs.lever.co/${s}`,
    hasJobs: j => Array.isArray(j),
  },
  {
    type: 'ashby',
    api: s => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    board: s => `https://jobs.ashbyhq.com/${s}`,
    hasJobs: j => Array.isArray(j?.jobs),
  },
];

async function fetchJsonQuiet(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Probe one company across ATS vendors + slug guesses. Sequential on purpose. */
export async function probeCompanyAts(company: string): Promise<DiscoveredBoard | null> {
  for (const slug of slugsFor(company)) {
    for (const ats of ATS) {
      const json = await fetchJsonQuiet(ats.api(slug));
      if (json && ats.hasJobs(json)) {
        return { company, ats: ats.type, boardUrl: ats.board(slug) };
      }
    }
  }
  return null;
}

/** Companies worth probing: extension-harvested, not cached, not blocked, no board yet. */
function candidateCompanies(limit: number): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT company, COUNT(*) n FROM jobs
    WHERE source LIKE '%-ext' AND company != ''
    GROUP BY company ORDER BY n DESC LIMIT 200
  `).all() as { company: string; n: number }[];

  const cachedOk = new Set<string>();
  const now = Date.now();
  for (const r of db.prepare('SELECT normalized_name, found, checked_at FROM ats_probe_cache').all() as any[]) {
    if (r.found || now - r.checked_at < RETRY_MISS_AFTER_MS) cachedOk.add(r.normalized_name);
  }
  const boardNames = new Set(
    (db.prepare('SELECT name FROM boards').all() as { name: string }[]).map(b => normalizeCompany(b.name))
  );

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const norm = normalizeCompany(r.company);
    if (!norm || seen.has(norm) || cachedOk.has(norm) || boardNames.has(norm) || isBlocked(r.company)) continue;
    seen.add(norm);
    out.push(r.company);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * One discovery pass: probe up to `limit` harvested companies, add any found
 * boards (enabled, api ingress), cache every result. Returns the additions.
 */
export async function discoverBoardsFromJobs(limit = 5): Promise<DiscoveredBoard[]> {
  const db = getDb();
  const companies = candidateCompanies(limit);
  const added: DiscoveredBoard[] = [];

  const cache = db.prepare(`
    INSERT INTO ats_probe_cache (normalized_name, found, checked_at) VALUES (?, ?, ?)
    ON CONFLICT(normalized_name) DO UPDATE SET found = excluded.found, checked_at = excluded.checked_at
  `);
  const insertBoard = db.prepare(
    'INSERT INTO boards (name, type, url, enabled, ingress, status, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)'
  );

  for (const company of companies) {
    const hit = await probeCompanyAts(company);
    cache.run(normalizeCompany(company), hit ? hit.ats : '', Date.now());
    if (hit) {
      insertBoard.run(company, 'company', hit.boardUrl, 'api', `${hit.ats}-auto`, Date.now());
      added.push(hit);
      console.log(`[ats-discover] ${company} → ${hit.boardUrl}`);
    }
  }
  return added;
}
