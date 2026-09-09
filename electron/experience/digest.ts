import { generate, type ChatMessage } from '../llm/provider';
import { parseJsonLoose, recoverTruncatedArray } from '../lib/json';
import type { Settings } from '../ipc/settings';

// 'project' is produced by the project-ingestion pipeline (electron/projects/)
// from a repo, a folder or a deployed app, and shares this table so tailoring
// picks projects and jobs out of one pool.
export type LineItemKind = 'accomplishment' | 'skill' | 'tool' | 'domain' | 'education' | 'project';
const KINDS: LineItemKind[] = ['accomplishment', 'skill', 'tool', 'domain', 'education', 'project'];

export interface LineItem {
  kind: LineItemKind;
  text: string;
  role?: string | null;
  employer?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  metrics?: string | null;
  seniority_signal?: string | null;
}

const SYSTEM = `You convert a candidate's career documents into atomic, reusable RESUME LINE ITEMS.
Each item is ONE accomplishment, skill, tool, domain, or education entry — small enough to mix and
match when tailoring a resume to a specific job. Preserve concrete metrics and scope.

Respond with ONLY a JSON array (no prose, no code fence) of objects:
[
  {
    "kind": "accomplishment" | "skill" | "tool" | "domain" | "education",
    "text": "<the line item, self-contained>",
    "role": "<job title if known, else null>",
    "employer": "<company/org if known, else null>",
    "start_date": "<YYYY or YYYY-MM, else null>",
    "end_date": "<YYYY or YYYY-MM or 'present', else null>",
    "metrics": "<quantified impact if any, else null>",
    "seniority_signal": "junior" | "mid" | "senior" | "lead" | null
  }
]
Rules: prefer accomplishment items with impact; split bullets that bundle multiple ideas;
list each distinct tool/skill once; keep text faithful to the source (no invented facts).

DATES ARE OFTEN MISSED — READ THIS: a resume states the employer, role and dates ONCE, in
the job's header line, above a whole block of bullets under it. The bullets themselves almost
never restate them. Every item you emit from inside that block — accomplishment, skill, tool,
domain, whatever kind — MUST carry that same employer, role, start_date and end_date, even
though those words never appear in the bullet's own text. Do not leave role/employer/dates null
just because the individual bullet you are reading does not repeat them itself; look up to the
job header above it. Only leave them null when the source genuinely never states them anywhere
(e.g. a skills section with no job attached).`;

export function buildDigestPrompt(text: string, sourceRef: string): ChatMessage[] {
  const clipped = text.length > 20000 ? text.slice(0, 20000) + '\n…[truncated]' : text;
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Source: ${sourceRef}\n\n---\n${clipped}\n---\n\nExtract the line items as a JSON array.` },
  ];
}

/**
 * Fill in a missing employer/role/start_date/end_date from the nearest
 * PRECEDING item in the same array that has it.
 *
 * A resume states the employer, role and dates once, in the job's header,
 * above a whole block of bullets — a bullet does not restate them itself.
 * The model is asked to carry that context down onto every item it emits
 * from inside the block (see the digest prompt), but it frequently misses
 * some, so this is a second, deterministic pass over the same document's
 * items in the order the model wrote them (which is the order they appeared
 * in the source).
 *
 * Never invents a date or employer: if nothing earlier in THIS array had one,
 * the gap stays a gap. Only ever call this on one document's own batch of
 * items, before it is merged into the wider corpus — carrying job context
 * from one resume into an unrelated one would fabricate history.
 */
export function propagateJobContext(items: LineItem[]): LineItem[] {
  let lastEmployer: string | null = null;
  let lastRole: string | null = null;
  let lastStart: string | null = null;
  let lastEnd: string | null = null;
  return items.map(item => {
    const filled: LineItem = {
      ...item,
      employer: item.employer ?? lastEmployer,
      role: item.role ?? lastRole,
      start_date: item.start_date ?? lastStart,
      end_date: item.end_date ?? lastEnd,
    };
    if (item.employer) lastEmployer = item.employer;
    if (item.role) lastRole = item.role;
    if (item.start_date) lastStart = item.start_date;
    if (item.end_date) lastEnd = item.end_date;
    return filled;
  });
}

/** Normalise/validate the LLM's JSON into clean LineItem rows. */
export function parseLineItems(llmText: string): LineItem[] {
  const parsed = parseJsonLoose<any>(llmText);
  const arr = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.items) ? parsed.items
    : (recoverTruncatedArray(llmText) ?? []);   // salvage a token-capped array
  const out: LineItem[] = [];
  for (const r of arr) {
    if (!r || typeof r.text !== 'string' || !r.text.trim()) continue;
    const kind: LineItemKind = KINDS.includes(r.kind) ? r.kind : 'accomplishment';
    out.push({
      kind,
      text: r.text.trim(),
      role: r.role ?? null,
      employer: r.employer ?? null,
      start_date: r.start_date ?? null,
      end_date: r.end_date ?? null,
      metrics: r.metrics ?? null,
      seniority_signal: r.seniority_signal ?? null,
    });
  }
  // One LLM response = one source document, so this is exactly the scope
  // propagation is allowed to work within.
  return propagateJobContext(out);
}

/** Full digest: prompt the LLM and parse the result into line items. */
export async function digestSource(s: Settings, text: string, sourceRef: string): Promise<LineItem[]> {
  const r = await generate(s, buildDigestPrompt(text, sourceRef), { temperature: 0.2, maxTokens: 9000 });
  return parseLineItems(r.text);
}
