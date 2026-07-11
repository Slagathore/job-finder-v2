import { generate, type ChatMessage } from '../llm/provider';
import { readSettings } from '../ipc/settings';
import { getProfile } from '../experience/store';
import { parseJsonLoose } from '../lib/json';

/**
 * Three career-ops "modes" ported as structured prompts:
 *  - project:  portfolio-project evaluator (modes/project.md)
 *  - training: course/cert study-plan evaluator (modes/training.md)
 *  - deep:     deep-research prompt generator (modes/deep.md) — pure template,
 *              no LLM call; the user pastes it into their research tool.
 * Prompt builders and parsers are pure and exported for tests.
 */

// ── Portfolio project evaluator ───────────────────────────────────────

export interface ProjectEval {
  verdict: 'BUILD' | 'SKIP' | 'PIVOT';
  score: number;                       // weighted 1-5
  dimensions: { name: string; score: number; note: string }[];
  pivot?: string;                      // when verdict = PIVOT
  plan: string[];                      // weekly milestones (when BUILD/PIVOT)
  interviewPack: string[];             // what to prepare for interviews
  rationale: string;
}

const PROJECT_SYSTEM = `Evaluate a candidate's portfolio-project idea for job-search impact.
Score 6 dimensions 1-5 with these weights:
- target-role signal (25%): directly demonstrates a skill from their target roles
- uniqueness (20%): 5 = nobody has this, 1 = everyone has it
- demo-ability (20%): 5 = live demo in 2 minutes, 1 = code-only, nothing visual
- metrics potential (15%): 5 = clear metrics possible (latency, cost, accuracy)
- time to MVP (10%): 5 = one week, 1 = three-plus months
- STAR story potential (10%): 5 = rich story with trade-offs, 1 = plain implementation
Verdict: BUILD (weighted >= 3.5), PIVOT (a sharper variant exists — name it), else SKIP.
Plan: 80/20 — week 1 = MVP with the core metric, week 2 = polish + interview pack (one-pager, 2-min demo, postmortem).
Respond with ONLY this JSON:
{ "verdict": "BUILD|SKIP|PIVOT", "score": <number>, "rationale": "<2 sentences>",
  "dimensions": [ { "name": "...", "score": <1-5>, "note": "<1 sentence>" } ],
  "pivot": "<the sharper variant, only when verdict is PIVOT>",
  "plan": ["<week-by-week milestones, empty when SKIP>"],
  "interviewPack": ["<artifacts to prepare>"] }`;

export function buildProjectPrompt(idea: string, profile: any): ChatMessage[] {
  return [{ role: 'system', content: PROJECT_SYSTEM },
    { role: 'user', content: `PROJECT IDEA: ${idea}\n\nCANDIDATE: ${profile?.narrative ?? 'n/a'}\nTarget-role skills: ${(profile?.skills ?? []).slice(0, 20).join(', ') || 'n/a'}` }];
}

export function parseProjectEval(text: string): ProjectEval {
  const p = parseJsonLoose<any>(text) ?? {};
  const strs = (x: any) => (Array.isArray(x) ? x.filter((s: any) => typeof s === 'string') : []);
  return {
    verdict: ['BUILD', 'SKIP', 'PIVOT'].includes(p.verdict) ? p.verdict : 'SKIP',
    score: Number(p.score) || 0,
    rationale: String(p.rationale ?? ''),
    dimensions: Array.isArray(p.dimensions)
      ? p.dimensions.filter((d: any) => d && d.name).map((d: any) => ({ name: String(d.name), score: Number(d.score) || 0, note: String(d.note ?? '') }))
      : [],
    pivot: typeof p.pivot === 'string' && p.pivot.trim() ? p.pivot : undefined,
    plan: strs(p.plan),
    interviewPack: strs(p.interviewPack),
  };
}

export async function evalProject(idea: string): Promise<{ eval: ProjectEval } | { error: string }> {
  if (!idea.trim()) return { error: 'Describe the project idea.' };
  try {
    const r = await generate(readSettings(), buildProjectPrompt(idea.trim(), getProfile()), { temperature: 0.3, maxTokens: 2500 });
    return { eval: parseProjectEval(r.text) };
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}

// ── Training / course evaluator ───────────────────────────────────────

export interface TrainingEval {
  verdict: 'DO' | 'DONT' | 'TIMEBOX';
  timeboxWeeks?: number;
  rationale: string;
  dimensions: { name: string; assessment: string }[];
  alternative?: string;                // when verdict = DONT
  plan: { week: number; deliverable: string }[];
}

const TRAINING_SYSTEM = `Evaluate whether a specific course or certification is worth a job-seeker's time.
Assess 6 dimensions: north-star alignment (does it move them toward their target roles?), recruiter signal
(what hiring managers think seeing it on a CV), time & effort, opportunity cost, risks (outdated content,
weak brand, too basic), and portfolio deliverable (does it produce a demonstrable artifact?).
Verdict: DO (plan of 4-12 weeks with weekly deliverables), DONT (name the better alternative), or
TIMEBOX (worth at most N weeks — condensed plan, essentials only).
Respond with ONLY this JSON:
{ "verdict": "DO|DONT|TIMEBOX", "timeboxWeeks": <number, only for TIMEBOX>, "rationale": "<2 sentences>",
  "dimensions": [ { "name": "...", "assessment": "<1 sentence>" } ],
  "alternative": "<better use of the time, only for DONT>",
  "plan": [ { "week": <n>, "deliverable": "<concrete weekly output>" } ] }`;

export function buildTrainingPrompt(course: string, profile: any): ChatMessage[] {
  return [{ role: 'system', content: TRAINING_SYSTEM },
    { role: 'user', content: `COURSE/CERT: ${course}\n\nCANDIDATE: ${profile?.narrative ?? 'n/a'}\nSkills: ${(profile?.skills ?? []).slice(0, 20).join(', ') || 'n/a'}` }];
}

export function parseTrainingEval(text: string): TrainingEval {
  const p = parseJsonLoose<any>(text) ?? {};
  return {
    verdict: ['DO', 'DONT', 'TIMEBOX'].includes(p.verdict) ? p.verdict : 'DONT',
    timeboxWeeks: Number(p.timeboxWeeks) || undefined,
    rationale: String(p.rationale ?? ''),
    dimensions: Array.isArray(p.dimensions)
      ? p.dimensions.filter((d: any) => d && d.name).map((d: any) => ({ name: String(d.name), assessment: String(d.assessment ?? '') }))
      : [],
    alternative: typeof p.alternative === 'string' && p.alternative.trim() ? p.alternative : undefined,
    plan: Array.isArray(p.plan)
      ? p.plan.filter((w: any) => w && w.deliverable).map((w: any) => ({ week: Number(w.week) || 0, deliverable: String(w.deliverable) }))
      : [],
  };
}

export async function evalTraining(course: string): Promise<{ eval: TrainingEval } | { error: string }> {
  if (!course.trim()) return { error: 'Name the course or certification.' };
  try {
    const r = await generate(readSettings(), buildTrainingPrompt(course.trim(), getProfile()), { temperature: 0.3, maxTokens: 2500 });
    return { eval: parseTrainingEval(r.text) };
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}

// ── Deep-research prompt generator (pure template, no LLM) ────────────

export function buildDeepResearchPrompt(company: string, role: string, profile: any): string {
  const skills = (profile?.skills ?? []).slice(0, 12).join(', ');
  const narrative = profile?.narrative ? `\nMy background: ${profile.narrative}` : '';
  return `## Deep Research: ${company} — ${role}

Context: I'm interviewing for ${role} at ${company}. I need actionable, current information — cite sources and dates where possible.

### 1. Product & technology strategy
- What are their core products, and which are growing or being sunset?
- What is their technology stack and how do they talk about it (engineering blog, talks, job postings)?
- Any AI/automation initiatives, and how mature are they?

### 2. Recent moves (last 6 months)
- Notable hires or departures in leadership and in the team I'd join
- Acquisitions, partnerships, product launches, or pivots
- Funding rounds, layoffs, or reorgs

### 3. Culture & how they work
- How do they ship? (release cadence, process signals from job posts and reviews)
- Remote/hybrid/office reality vs what they advertise
- What do Glassdoor/Blind reviews consistently praise and complain about?

### 4. Likely challenges
- What scaling, reliability, cost, or process problems do they visibly have?
- Are they migrating anything (platforms, infra, tooling)?
- What pain points do current/former employees mention?

### 5. Competitors & differentiation
- Who are their main competitors and how do they position against them?
- What is their moat — and what threatens it?

### 6. My angle
Given my profile — ${skills || 'see below'}${narrative}
- Where does someone with my background add the most value to this team?
- Which of my experiences are most relevant to their current challenges?
- What story should I lead with in the interview?`;
}
