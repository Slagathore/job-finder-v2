import { generate, type ChatMessage } from '../llm/provider';
import { parseJsonLoose } from '../lib/json';
import type { Settings } from '../ipc/settings';
import type { Grade } from './rank';

export interface GradeResult {
  grade: Grade;
  rationale: string;
  supporting_item_ids: number[];
}

const GRADES = ['A', 'B', 'C', 'D', 'F'];

const SYSTEM = `You assess how well a job fits a candidate, using ONLY their supplied experience line items.
The candidate prioritizes high pay and remote work. Grade A (excellent) to F (poor) on genuine fit —
be honest, and note transferable/adjacent fit, not just exact matches.

Respond with ONLY this JSON (no prose, no fence):
{ "grade": "A|B|C|D|F", "rationale": "<2-3 sentences>", "supporting_item_ids": [<ids of the most relevant line items>] }`;

export interface GradeItem { id: number; kind: string; text: string; }

export function buildGradePrompt(
  job: { title: string; company: string; location_raw?: string | null; description?: string | null },
  items: GradeItem[]
): ChatMessage[] {
  const jd = (job.description ?? '').slice(0, 6000);
  const itemList = items.map(i => `[${i.id}] (${i.kind}) ${i.text}`).join('\n');
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content:
`JOB
Title: ${job.title}
Company: ${job.company}
Location: ${job.location_raw ?? 'n/a'}
Description:
${jd || '(no description)'}

CANDIDATE LINE ITEMS
${itemList || '(none)'}

Return the fit JSON.` },
  ];
}

export function parseGrade(text: string): GradeResult {
  const p = parseJsonLoose<any>(text);
  const g = typeof p?.grade === 'string' ? p.grade.toUpperCase().trim() : '';
  // A missing/garbled grade is an ERROR, not an 'F' — silently storing F would
  // systematically bury good jobs on any transient LLM parse hiccup.
  if (!p || !GRADES.includes(g)) throw new Error('Model did not return a usable grade JSON — try again.');
  return {
    grade: g as Grade,
    rationale: typeof p.rationale === 'string' ? p.rationale : '',
    supporting_item_ids: Array.isArray(p.supporting_item_ids)
      ? p.supporting_item_ids.filter((x: any) => Number.isInteger(x))
      : [],
  };
}

export async function gradeJobLlm(s: Settings, job: any, items: GradeItem[]): Promise<GradeResult> {
  const r = await generate(s, buildGradePrompt(job, items), { temperature: 0.2, maxTokens: 700 });
  return parseGrade(r.text);
}
