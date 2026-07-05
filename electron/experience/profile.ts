import { generate, type ChatMessage } from '../llm/provider';
import { parseJsonLoose } from '../lib/json';
import type { Settings } from '../ipc/settings';
import type { LineItem } from './digest';

export interface DerivedProfile {
  skills: string[];
  domains: string[];
  seniority: string | null;
  total_yoe: number | null;
  narrative: string | null;
}
export interface RoleFit {
  role_family: string;
  industry: string | null;
  taxonomy_code: string | null;
  confidence: number;
  rationale: string | null;
}

const SYSTEM = `You are a career analyst. From a candidate's experience line items, infer:
1) a structured PROFILE, and
2) the ROLE FAMILIES and INDUSTRIES they could realistically target — INCLUDING adjacent and
   cross-industry options they might not think of themselves. The candidate prioritizes high pay
   and remote work, so favor surfacing well-paying and remote-friendly directions.

Anchor role_family labels to standard occupational categories (O*NET / ESCO style) where possible,
but you MAY add niche or emerging families. Be generous with adjacencies but honest about confidence.

Respond with ONLY this JSON (no prose, no fence):
{
  "profile": {
    "skills": ["..."],
    "domains": ["..."],
    "seniority": "junior|mid|senior|lead|null",
    "total_yoe": <number or null>,
    "narrative": "<2-3 sentence positioning summary>"
  },
  "role_fits": [
    { "role_family": "...", "industry": "...|null", "taxonomy_code": "<O*NET/ESCO code or null>",
      "confidence": <0..1>, "rationale": "<why this fits, 1 sentence>" }
  ]
}`;

export function buildProfilePrompt(items: LineItem[]): ChatMessage[] {
  const lines = items.map(i => `- [${i.kind}] ${i.text}${i.employer ? ` (${i.employer})` : ''}`);
  let corpus = lines.join('\n');
  if (corpus.length > 14000) corpus = corpus.slice(0, 14000) + '\n…[truncated]';
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Candidate experience line items:\n\n${corpus}\n\nProduce the profile + role_fits JSON.` },
  ];
}

export function parseProfileResult(llmText: string): { profile: DerivedProfile; roleFits: RoleFit[] } {
  const p = parseJsonLoose<any>(llmText) ?? {};
  const prof = p.profile ?? {};
  const profile: DerivedProfile = {
    skills: Array.isArray(prof.skills) ? prof.skills.map(String) : [],
    domains: Array.isArray(prof.domains) ? prof.domains.map(String) : [],
    seniority: prof.seniority ?? null,
    total_yoe: typeof prof.total_yoe === 'number' ? prof.total_yoe : null,
    narrative: prof.narrative ?? null,
  };
  const roleFits: RoleFit[] = (Array.isArray(p.role_fits) ? p.role_fits : [])
    .filter((r: any) => r && typeof r.role_family === 'string' && r.role_family.trim())
    .map((r: any) => ({
      role_family: r.role_family.trim(),
      industry: r.industry ?? null,
      taxonomy_code: r.taxonomy_code ?? null,
      confidence: typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
      rationale: r.rationale ?? null,
    }));
  return { profile, roleFits };
}

export async function inferProfileAndRoles(
  s: Settings, items: LineItem[]
): Promise<{ profile: DerivedProfile; roleFits: RoleFit[] }> {
  const r = await generate(s, buildProfilePrompt(items), { temperature: 0.3, maxTokens: 6000 });
  return parseProfileResult(r.text);
}

// ── Gap-filling Q&A (PLAN.md §6.9 / §6.12) ───────────────────────────────────

const QUESTIONS_SYSTEM = `You are onboarding a candidate. Given their current experience line items
(possibly empty), ask the SHORT, high-value questions whose answers would most improve resume
tailoring and role matching — gaps, missing metrics, unstated preferences, comp expectations,
location/remote needs. Respond with ONLY a JSON array of question strings (max 8).`;

export function buildQuestionsPrompt(items: LineItem[]): ChatMessage[] {
  const corpus = items.length
    ? items.slice(0, 120).map(i => `- [${i.kind}] ${i.text}`).join('\n')
    : '(no experience captured yet)';
  return [
    { role: 'system', content: QUESTIONS_SYSTEM },
    { role: 'user', content: `Current line items:\n${corpus}\n\nReturn the questions JSON array.` },
  ];
}

export function parseQuestions(llmText: string): string[] {
  const p = parseJsonLoose<any>(llmText);
  const arr = Array.isArray(p) ? p : Array.isArray(p?.questions) ? p.questions : [];
  return arr.filter((q: any) => typeof q === 'string' && q.trim()).map((q: string) => q.trim()).slice(0, 8);
}

export async function suggestQuestions(s: Settings, items: LineItem[]): Promise<string[]> {
  const r = await generate(s, buildQuestionsPrompt(items), { temperature: 0.4, maxTokens: 800 });
  return parseQuestions(r.text);
}
