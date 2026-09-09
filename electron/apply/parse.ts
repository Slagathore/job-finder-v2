import type { ChatMessage } from '../llm/provider';
import { parseJsonLoose } from '../lib/json';

// Pure tailoring helpers — no electron/db imports, so they stay unit-testable.

export interface TailoredDoc {
  summary: string;
  sections: { heading: string; bullets: string[] }[];
  coverLetter: string;
  selectedItemIds: number[];
}

const SYSTEM = `You tailor a candidate's resume + cover letter to ONE job, using ONLY their real
experience line items (never invent facts). Select and rephrase the most relevant items, ordered by
impact for THIS role. Honor the user's rules. Keep the cover letter to ~150-200 words.

STRUCTURE: If the LINE ITEMS include any items of kind "education", always emit an "Education" section.
If they include work-history items (kind "accomplishment" tied to a role/employer), always emit an
"Experience" section grouping bullets under each employer, not just a generic "Relevant Experience" dump.
Never drop education or prior employers just because they score lower on topical relevance — every
distinct employer and every education entry present in LINE ITEMS should appear somewhere in sections.

STYLE: Write like a specific human, not an AI assistant. Never use em dashes or en dashes as
punctuation, use commas or periods instead. Never use contrast framing like "not only X but Y",
"it's not just X, it's Y", or "X isn't just Y". Avoid corporate-AI vocabulary: leverage, utilize,
spearhead, foster, robust, dynamic, seamless, cutting-edge, passionate, results-driven. Vary sentence
length and structure; do not repeat the same bullet template or sentence opener twice in a row. Prefer
plain verbs and concrete nouns over buzzwords.

Respond with ONLY this JSON (no prose, no fence):
{
  "summary": "<2-3 sentence headline tailored to the role>",
  "sections": [ { "heading": "<e.g. Relevant Experience / Skills>", "bullets": ["<concise bullet>"] } ],
  "coverLetter": "<plain-text cover letter>",
  "selectedItemIds": [<ids of the line items you drew from>]
}`;

export function buildTailorPrompt(
  job: { title: string; company: string; description?: string | null },
  items: { id: number; kind: string; text: string }[],
  profile: { narrative?: string | null; skills?: string[] } | null,
  rules: string[]
): ChatMessage[] {
  const jd = (job.description ?? '').slice(0, 5000);
  const itemList = items.map(i => `[${i.id}] (${i.kind}) ${i.text}`).join('\n');
  const rulesBlock = rules.length ? rules.map(r => `- ${r}`).join('\n') : '(none)';
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content:
`JOB
Title: ${job.title}
Company: ${job.company}
Description:
${jd || '(no description)'}

CANDIDATE POSITIONING: ${profile?.narrative ?? '(n/a)'}

LINE ITEMS (use only these):
${itemList || '(none)'}

USER RULES:
${rulesBlock}

Return the tailored JSON.` },
  ];
}

export function parseTailored(text: string): TailoredDoc {
  const p = parseJsonLoose<any>(text) ?? {};
  const sections = Array.isArray(p.sections) ? p.sections
    .filter((s: any) => s && typeof s.heading === 'string')
    .map((s: any) => ({ heading: s.heading, bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : [] })) : [];
  return {
    summary: typeof p.summary === 'string' ? p.summary : '',
    sections,
    coverLetter: typeof p.coverLetter === 'string' ? p.coverLetter : '',
    selectedItemIds: Array.isArray(p.selectedItemIds) ? p.selectedItemIds.filter((x: any) => Number.isInteger(x)) : [],
  };
}
