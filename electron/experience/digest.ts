import { generate, type ChatMessage } from '../llm/provider';
import { parseJsonLoose, recoverTruncatedArray } from '../lib/json';
import type { Settings } from '../ipc/settings';

export type LineItemKind = 'accomplishment' | 'skill' | 'tool' | 'domain' | 'education';
const KINDS: LineItemKind[] = ['accomplishment', 'skill', 'tool', 'domain', 'education'];

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
list each distinct tool/skill once; keep text faithful to the source (no invented facts).`;

export function buildDigestPrompt(text: string, sourceRef: string): ChatMessage[] {
  const clipped = text.length > 20000 ? text.slice(0, 20000) + '\n…[truncated]' : text;
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Source: ${sourceRef}\n\n---\n${clipped}\n---\n\nExtract the line items as a JSON array.` },
  ];
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
  return out;
}

/** Full digest: prompt the LLM and parse the result into line items. */
export async function digestSource(s: Settings, text: string, sourceRef: string): Promise<LineItem[]> {
  const r = await generate(s, buildDigestPrompt(text, sourceRef), { temperature: 0.2, maxTokens: 9000 });
  return parseLineItems(r.text);
}
