import { getDb } from '../ipc/db';
import type { PatchSet } from './patcher';

export function saveProposal(set: PatchSet, scan: any): number {
  const info = getDb().prepare(
    `INSERT INTO patch_proposals (rationale, files, scan_result, status, created_at) VALUES (?, ?, ?, 'proposed', ?)`
  ).run(set.rationale, JSON.stringify(set), JSON.stringify(scan), Date.now());
  return Number(info.lastInsertRowid);
}

export function listProposals(): any[] {
  return getDb().prepare('SELECT id, rationale, status, scan_result, sandbox_result, created_at FROM patch_proposals ORDER BY id DESC').all();
}

export function getProposal(id: number): any | null {
  const row = getDb().prepare('SELECT * FROM patch_proposals WHERE id = ?').get(id) as any;
  if (!row) return null;
  try { row.patch = JSON.parse(row.files) as PatchSet; } catch { row.patch = null; }
  try { row.scan = JSON.parse(row.scan_result || 'null'); } catch { row.scan = null; }
  try { row.sandbox = JSON.parse(row.sandbox_result || 'null'); } catch { row.sandbox = null; }
  return row;
}

export function setSandboxResult(id: number, result: any): void {
  getDb().prepare('UPDATE patch_proposals SET sandbox_result = ? WHERE id = ?').run(JSON.stringify(result), id);
}
export function setStatus(id: number, status: string): void {
  getDb().prepare('UPDATE patch_proposals SET status = ? WHERE id = ?').run(status, id);
}
