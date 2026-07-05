import { createHash } from 'crypto';

/** Pure: next hash in the tamper-evident audit chain (no db imports). */
export function chainHash(prevHash: string, entry: { ts: number; actor: string; action: string; payload: any }): string {
  return createHash('sha256')
    .update(`${prevHash}|${entry.ts}|${entry.actor}|${entry.action}|${JSON.stringify(entry.payload ?? null)}`)
    .digest('hex');
}
