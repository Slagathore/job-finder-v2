import { ipcMain, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from './db';

const csvCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
// Job URLs come from scraped/external sources — only ever link http(s).
const safeHref = (u: any) => /^https?:\/\//i.test(String(u ?? '')) ? esc(u) : '';

/** Export the pipeline (jobs ⨝ applications) to CSV + a styled HTML report. */
export function registerExportHandlers() {
  ipcMain.handle('export:pipeline', () => {
    const rows = getDb().prepare(`
      SELECT j.company, j.title, j.url, j.work_mode, j.salary_listed,
             COALESCE(a.state, j.status) AS state, j.fit_score, a.route, a.submitted_at
      FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
      WHERE a.id IS NOT NULL OR j.starred = 1
      ORDER BY COALESCE(a.submitted_at, j.first_seen) DESC
    `).all() as any[];

    const cols = ['company', 'title', 'state', 'fit_score', 'work_mode', 'route', 'salary_listed', 'submitted_at', 'url'];
    const csv = [cols.join(',')].concat(rows.map(r =>
      cols.map(c => csvCell(c === 'submitted_at' ? (r[c] ? new Date(r[c]).toISOString().slice(0, 10) : '') : r[c])).join(','))).join('\n');

    const html = `<!doctype html><meta charset="utf-8"><style>
      body{font:13px/1.5 -apple-system,Segoe UI,sans-serif;margin:28px;color:#1a1a1a}
      h1{font-size:20px} table{border-collapse:collapse;width:100%} th,td{border-bottom:1px solid #ddd;padding:6px 9px;text-align:left}
      th{background:#f4f6fb} a{color:#3a6fe0;text-decoration:none}</style>
      <h1>Job Finder — pipeline (${rows.length})</h1><p>${new Date().toLocaleString()}</p><table>
      <tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>
      ${rows.map(r => `<tr>${cols.map(c =>
        c === 'url' ? `<td>${safeHref(r.url) ? `<a href="${safeHref(r.url)}">link</a>` : ''}</td>`
        : c === 'submitted_at' ? `<td>${r[c] ? new Date(r[c]).toLocaleDateString() : ''}</td>`
        : `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}
      </table>`;

    const dir = path.join(app.getPath('userData'), 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const csvPath = path.join(dir, `pipeline-${stamp}.csv`);
    const htmlPath = path.join(dir, `pipeline-${stamp}.html`);
    fs.writeFileSync(csvPath, csv, 'utf-8');
    fs.writeFileSync(htmlPath, html, 'utf-8');
    return { csv: csvPath, html: htmlPath, rows: rows.length };
  });
}
