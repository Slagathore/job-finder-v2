import { ipcMain } from 'electron';
import { getDb } from './db';
import { computeFollowups, type FollowupInput } from '../followup/cadence';

export function registerFollowupHandlers() {
  ipcMain.handle('followups:list', () => {
    const rows = getDb().prepare(`
      SELECT a.id AS appId, a.job_id AS jobId, j.company, j.title, j.url, a.state,
             COALESCE(a.submitted_at, a.created_at) AS since
      FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.state IN ('applied','responded','interview')
    `).all() as FollowupInput[];
    return computeFollowups(rows, Date.now());
  });
}
