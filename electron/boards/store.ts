import { getDb } from '../ipc/db';
import type { SiteAdapter } from './learn';

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function saveAdapter(url: string, adapter: SiteAdapter, sampleCount: number): void {
  const db = getDb();
  const domain = hostOf(url);
  const now = Date.now();
  db.prepare('DELETE FROM site_adapters WHERE domain = ? AND scope = ?').run(domain, 'list');
  db.prepare(`
    INSERT INTO site_adapters (domain, scope, extract, learned_by, confidence, last_verified)
    VALUES (?, 'list', ?, 'agentic', ?, ?)
  `).run(domain, JSON.stringify(adapter), sampleCount > 0 ? 0.7 : 0.3, now);
}

export function getAdapterForDomain(url: string): SiteAdapter | null {
  const row = getDb().prepare(
    'SELECT extract FROM site_adapters WHERE domain = ? AND scope = ? ORDER BY last_verified DESC LIMIT 1'
  ).get(hostOf(url), 'list') as { extract: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.extract) as SiteAdapter; } catch { return null; }
}
