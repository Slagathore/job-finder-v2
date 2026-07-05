import { getDb } from '../ipc/db';
import { chainHash } from './hash';

export { chainHash };

/** Append a hash-chained audit entry (PLAN.md §6.12). */
export function appendAudit(actor: 'user' | 'agent', action: string, payload: any): void {
  const db = getDb();
  const ts = Date.now();
  const prev = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
  const prevHash = prev?.hash ?? 'genesis';
  const hash = chainHash(prevHash, { ts, actor, action, payload });
  db.prepare('INSERT INTO audit_log (ts, actor, action, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ts, actor, action, JSON.stringify(payload ?? null), prevHash, hash);
}
