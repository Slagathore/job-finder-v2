import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { addNotification } from '../ipc/notifications';
import { refreshAccessToken } from './auth';
import { listMessages, getMessage } from './client';
import { classifyEmail, stateForClassification } from './classify';
import { matchEmailToApplication, type AppRow } from './match';

export interface IngestSummary { processed: number; matched: number; advanced: number; error?: string; }

/**
 * Ingest recent inbox mail: classify each new message, match it to an open
 * application, and advance the pipeline state (PLAN.md §6.10). Idempotent via
 * the email_messages dedup on message_id.
 */
export async function ingestInbox(): Promise<IngestSummary> {
  const s = readSettings();
  if (!s.gmailRefreshToken) return { processed: 0, matched: 0, advanced: 0, error: 'Gmail not connected.' };
  const db = getDb();

  let token: string;
  try { token = await refreshAccessToken(s.gmailClientId, s.gmailClientSecret, s.gmailRefreshToken); }
  catch (e: any) { return { processed: 0, matched: 0, advanced: 0, error: `auth: ${e?.message ?? e}` }; }

  let msgs: { id: string }[];
  try { msgs = await listMessages(token, 'newer_than:30d -category:promotions -category:social'); }
  catch (e: any) { return { processed: 0, matched: 0, advanced: 0, error: e?.message ?? String(e) }; }

  const seen = new Set((db.prepare('SELECT message_id FROM email_messages').all() as any[]).map(r => r.message_id));
  const apps = db.prepare(`
    SELECT a.id AS appId, a.job_id AS jobId, j.company AS company
    FROM applications a JOIN jobs j ON j.id = a.job_id
    WHERE a.state IN ('tailored','applied','responded','interview')
  `).all() as AppRow[];

  let processed = 0, matched = 0, advanced = 0;
  for (const m of msgs) {
    if (seen.has(m.id)) continue;
    let email; try { email = await getMessage(token, m.id); } catch { continue; }
    let cls; try { cls = await classifyEmail(s, email); } catch { cls = { classification: 'other' as const, company: null }; }
    const app = matchEmailToApplication(email, cls.company, apps);

    db.prepare('INSERT OR IGNORE INTO email_messages (message_id, application_id, sender, subject, classification, received_at, raw_ref) VALUES (?,?,?,?,?,?,?)')
      .run(m.id, app?.appId ?? null, email.from, email.subject, cls.classification, Date.now(), email.id);
    processed++;

    if (app) {
      matched++;
      const newState = stateForClassification(cls.classification);
      if (newState) {
        db.prepare('UPDATE applications SET state = ? WHERE id = ?').run(newState, app.appId);
        advanced++;
        addNotification('email', { subject: email.subject, classification: cls.classification, company: app.company, jobId: app.jobId });
      }
    }
  }
  return { processed, matched, advanced };
}
