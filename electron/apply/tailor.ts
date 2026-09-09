import { generate } from '../llm/provider';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { getProfile } from '../experience/store';
import { rulesForScopes } from '../ipc/rules';
import { cosine, fromBlob } from '../discovery/vector';
import { buildTailorPrompt, parseTailored, type TailoredDoc } from './parse';

export { buildTailorPrompt, parseTailored, type TailoredDoc };

/**
 * Choose the most relevant line items for a job (by embedding sim if available), but always
 * guarantee every education entry and at least one item per distinct employer makes it in —
 * pure similarity ranking can otherwise drop job history / education entirely for skill-heavy
 * job descriptions, leaving the tailored resume with no Experience or Education section.
 */
function selectItems(job: any, max = 28): { id: number; kind: string; text: string }[] {
  const db = getDb();
  const items = db.prepare('SELECT id, kind, text, employer, embedding FROM experience_items').all() as any[];

  const ranked = (job.embedding && items.some(i => i.embedding))
    ? (() => {
        const jv = fromBlob(job.embedding);
        return items.filter(i => i.embedding)
          .map(i => ({ i, sim: cosine(jv, fromBlob(i.embedding)) }))
          .sort((a, b) => b.sim - a.sim)
          .map(({ i }) => i);
      })()
    : items;

  const guaranteed: any[] = [];
  const seenEmployers = new Set<string>();
  for (const i of ranked) {
    if (i.kind === 'education') { guaranteed.push(i); continue; }
    if (i.employer && !seenEmployers.has(i.employer)) { seenEmployers.add(i.employer); guaranteed.push(i); }
  }
  const guaranteedIds = new Set(guaranteed.map(i => i.id));
  const rest = ranked.filter(i => !guaranteedIds.has(i.id));

  const selected = [...guaranteed, ...rest].slice(0, Math.max(max, guaranteed.length));
  return selected.map(i => ({ id: i.id, kind: i.kind, text: i.text }));
}

export interface TailorContext { job: any; profile: any; tailored: TailoredDoc; }

export async function tailorForJob(jobId: number): Promise<TailorContext | { error: string }> {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
  if (!job) return { error: 'Job not found.' };
  const items = selectItems(job);
  if (items.length === 0) return { error: 'No experience line items. Import experience first.' };
  const profile = getProfile();
  const rules = rulesForScopes(['resume', 'apply']);
  try {
    const r = await generate(readSettings(), buildTailorPrompt(job, items, profile, rules), { temperature: 0.3, maxTokens: 6000 });
    return { job, profile, tailored: parseTailored(r.text) };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}
