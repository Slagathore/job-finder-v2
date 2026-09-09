/**
 * Per-repo ingestion state.
 *
 * A scan over three dozen repos is long enough that the app will be closed
 * partway through at least once. The state lives in the DB rather than in
 * memory so reopening shows what really happened instead of starting over, and
 * so a rerun skips what is already done at the depth asked for.
 */

import { getDb } from '../ipc/db';
import type { GhRepo } from './github';
import { alreadyDigested, type ProjectDepth } from './resume-rule';

export type RepoState = 'pending' | 'running' | 'done' | 'error';

export interface RepoRow {
  id: number;
  full_name: string;
  private: number;
  description: string | null;
  language: string | null;
  pushed_at: string | null;
  html_url: string | null;
  default_branch: string | null;
  state: RepoState;
  depth: ProjectDepth | null;
  items: number;
  digested_at: number | null;
  last_error: string | null;
  updated_at: number;
}

/** Insert or refresh repo metadata without disturbing digest state. */
export function upsertRepos(repos: GhRepo[]): { added: number; updated: number } {
  const db = getDb();
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO project_repos
      (full_name, private, description, language, pushed_at, html_url, default_branch, state, depth, items, updated_at)
    VALUES (@full_name, @private, @description, @language, @pushed_at, @html_url, @default_branch, 'pending', NULL, 0, @updated_at)
    ON CONFLICT(full_name) DO UPDATE SET
      private = excluded.private,
      description = excluded.description,
      language = excluded.language,
      pushed_at = excluded.pushed_at,
      html_url = excluded.html_url,
      default_branch = excluded.default_branch,
      updated_at = excluded.updated_at
  `);
  let added = 0, updated = 0;
  const known = new Set(
    (db.prepare('SELECT full_name FROM project_repos').all() as { full_name: string }[]).map(r => r.full_name)
  );
  const tx = db.transaction((rows: GhRepo[]) => {
    for (const r of rows) {
      insert.run({
        full_name: r.full_name, private: r.private ? 1 : 0, description: r.description,
        language: r.language, pushed_at: r.pushed_at, html_url: r.html_url,
        default_branch: r.default_branch, updated_at: now,
      });
      if (known.has(r.full_name)) updated++; else added++;
    }
  });
  tx(repos);
  return { added, updated };
}

export function listRepos(): RepoRow[] {
  return getDb().prepare(
    `SELECT * FROM project_repos
      ORDER BY CASE state WHEN 'error' THEN 0 WHEN 'running' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
               COALESCE(pushed_at, '') DESC`
  ).all() as RepoRow[];
}

export function getRepoRow(fullName: string): RepoRow | null {
  return (getDb().prepare('SELECT * FROM project_repos WHERE full_name = ?').get(fullName) as RepoRow) ?? null;
}

export function setRepoState(fullName: string, state: RepoState, lastError?: string | null): void {
  getDb().prepare(
    'UPDATE project_repos SET state = ?, last_error = ?, updated_at = ? WHERE full_name = ?'
  ).run(state, lastError ?? null, Date.now(), fullName);
}

export function markDigested(fullName: string, depth: ProjectDepth, items: number): void {
  const now = Date.now();
  getDb().prepare(
    `UPDATE project_repos
        SET state = 'done', depth = ?, items = ?, digested_at = ?, last_error = NULL, updated_at = ?
      WHERE full_name = ?`
  ).run(depth, items, now, now, fullName);
}

/** Any repo left 'running' when the app died is really pending again. */
export function clearStaleRunning(): void {
  getDb().prepare("UPDATE project_repos SET state = 'pending' WHERE state = 'running'").run();
}

export { alreadyDigested };

/** The repos a scan at this depth still has work to do on. */
export function pendingRepos(depth: ProjectDepth): RepoRow[] {
  return listRepos().filter(r => !alreadyDigested(r, depth));
}

export function repoCounts(): { total: number; done: number; error: number; pending: number } {
  const rows = listRepos();
  return {
    total: rows.length,
    done: rows.filter(r => r.state === 'done').length,
    error: rows.filter(r => r.state === 'error').length,
    pending: rows.filter(r => r.state === 'pending' || r.state === 'running').length,
  };
}
