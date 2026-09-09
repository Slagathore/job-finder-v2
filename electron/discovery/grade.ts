import { generate, type ChatMessage } from '../llm/provider';
import { parseJsonLoose } from '../lib/json';
import type { Settings } from '../ipc/settings';
import { GRADES, type Grade } from './rank';

export interface GradeResult {
  grade: Grade;
  rationale: string;
  supporting_item_ids: number[];
}

/**
 * The candidate's own constraints, so a letter means the same thing on every
 * job. Without these the grader was guessing at what "good pay" meant and every
 * job came back looking fine.
 */
export interface GradeContext {
  profile?: {
    skills?: string[]; domains?: string[];
    seniority?: string | null; total_yoe?: number | null; narrative?: string | null;
  } | null;
  /** Annual USD. floor = will not go below, target = what they are aiming at. */
  payFloor?: number | null;
  payTarget?: number | null;
  /** '', 'remote', 'hybrid' or 'onsite'. Empty means no stated preference. */
  workModePreference?: string | null;
  locationPreference?: string | null;
  radiusMi?: number | null;
}

const SYSTEM = `You assess how well a job fits a candidate, using ONLY their supplied experience
line items, derived profile, and stated constraints. Judge against the criteria below so the same
letter means the same thing on every job.

CRITERIA, in order of weight:
1. Requirements match. Does the candidate's experience cover the core requirements, directly or
   through close adjacent work? Credit transferable experience, do not credit wishful thinking.
2. Pay. Below the stated floor is disqualifying. At or above the target is a strong plus.
   Unlisted pay is unknown, not bad: say so instead of guessing.
3. Work mode. Compare the posting against the stated preference.
4. Location. Compare the posting against the stated home area and radius. Remote makes this moot.
5. Seniority. A role far above or far below the candidate's level is a worse fit, both ways.

GRADE MEANINGS:
A: clears the pay floor and is near or above target, work mode and location both work, and the
   candidate has direct experience for most core requirements.
B: clears the pay floor, work mode and location work, and the requirements are covered directly
   or by close adjacent experience.
C: workable with one real gap, such as pay below target, a compromise on mode or location, or a
   meaningful chunk of the requirements covered only by adjacent experience.
D: two or more of those gaps, or a clear stretch in seniority or field.
F: below the pay floor, or the mode or location is a dealbreaker, or little relevant experience.

Write the rationale in plain prose. Name the specific reason for the letter, including the one
thing that would move it up. No em dashes.

Respond with ONLY this JSON (no prose, no fence):
{ "grade": "A|B|C|D|F", "rationale": "<2-3 sentences>", "supporting_item_ids": [<ids of the most relevant line items>] }`;

export interface GradeItem { id: number; kind: string; text: string; }

const money = (n: number | null | undefined) =>
  typeof n === 'number' && n > 0 ? `$${Math.round(n / 1000)}k/yr` : null;

/** Render the candidate's constraints for the prompt. Unset lines say "not set". */
export function buildCandidateContext(ctx: GradeContext): string {
  const p = ctx.profile ?? null;
  const lines = [
    `Pay floor: ${money(ctx.payFloor) ?? 'not set'}`,
    `Pay target: ${money(ctx.payTarget) ?? 'not set'}`,
    `Work mode preference: ${(ctx.workModePreference || '').trim() || 'no stated preference'}`,
    `Home area: ${(ctx.locationPreference || '').trim() || 'not set'}${
      ctx.radiusMi ? `, willing to commute about ${Math.round(ctx.radiusMi)} miles` : ''}`,
    `Seniority: ${p?.seniority || 'unknown'}${
      typeof p?.total_yoe === 'number' ? `, about ${p.total_yoe} years of experience` : ''}`,
    `Core skills: ${(p?.skills ?? []).slice(0, 30).join(', ') || 'see line items'}`,
    `Domains: ${(p?.domains ?? []).slice(0, 15).join(', ') || 'see line items'}`,
  ];
  if (p?.narrative) lines.push(`Positioning: ${p.narrative}`);
  return lines.join('\n');
}

export function buildGradePrompt(
  job: { title: string; company: string; location_raw?: string | null; description?: string | null; salary_listed?: string | null; work_mode?: string | null },
  items: GradeItem[],
  ctx: GradeContext = {}
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
Work mode: ${job.work_mode || 'not stated'}
Listed pay: ${job.salary_listed || 'not listed'}
Description:
${jd || '(no description)'}

CANDIDATE CONSTRAINTS AND PROFILE
${buildCandidateContext(ctx)}

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
  if (!p || !(GRADES as string[]).includes(g)) throw new Error('Model did not return a usable grade JSON, try again.');
  return {
    grade: g as Grade,
    rationale: typeof p.rationale === 'string' ? p.rationale : '',
    supporting_item_ids: Array.isArray(p.supporting_item_ids)
      ? p.supporting_item_ids.filter((x: any) => Number.isInteger(x))
      : [],
  };
}

export async function gradeJobLlm(s: Settings, job: any, items: GradeItem[], ctx: GradeContext = {}): Promise<GradeResult> {
  const r = await generate(s, buildGradePrompt(job, items, ctx), { temperature: 0.2, maxTokens: 900 });
  return parseGrade(r.text);
}
