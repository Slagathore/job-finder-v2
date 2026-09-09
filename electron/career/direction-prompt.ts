/**
 * Career direction deep dive: prompt building and parsing (pure, no db or
 * electron imports, so vitest can load it).
 *
 * The point of this feature is someone who does not know what he should do for
 * work or what he is qualified for. So the prompt is built to force evidence:
 * every claim of fit has to quote the line items it came from, weak fits have to
 * be called weak, and at least one direction has to be something outside the
 * role fits already on file.
 */

import type { ChatMessage } from '../llm/provider';
import { parseJsonLoose, recoverTruncatedArray } from '../lib/json';
import { describeIntake, splitList, type IntakeAnswers } from './intake';

export interface DirectionLineItem { id?: number; kind: string; text: string; employer?: string | null; source_ref?: string | null; }
export interface DirectionRoleFit { role_family: string; industry?: string | null; confidence?: number | null; rationale?: string | null; }

export interface DirectionContext {
  profile: any | null;
  items: DirectionLineItem[];
  roleFits: DirectionRoleFit[];
  intake: IntakeAnswers;
}

export interface DirectionSearchHint { roleFamily?: string; titles?: string[]; keyword?: string }

export interface Direction {
  title: string;
  kind: 'core' | 'adjacency';
  fit: number;
  why: string;
  evidence: string[];
  gaps: string[];
  pay: string;
  demand: string;
  next_step: string;
  titles: string[];
  industries: string[];
  role_fits: { role_family: string; industry: string | null; confidence: number; rationale: string }[];
}

export interface DirectionReport {
  summary: string;
  directions: Direction[];
  honest_note: string;
  adjacency_note: string;
}

const CERT_RE = /\b(certifi|certificate|certification|licen[cs]e|licensed|credential|accredit)/i;

/** Line items that read as a real credential the candidate already holds. */
export function collectCertSignals(items: DirectionLineItem[]): string[] {
  return items
    .filter(i => i && typeof i.text === 'string' && CERT_RE.test(i.text))
    .map(i => i.text.trim())
    .slice(0, 12);
}

function norm(s: string): string { return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

/**
 * A direction is an adjacency when it is not already one of the role fits on
 * file. That is measured, not guessed: nothing is relabelled to satisfy a quota.
 */
export function markAdjacencies(directions: Direction[], knownRoleFamilies: string[]): Direction[] {
  const known = knownRoleFamilies.map(norm).filter(Boolean);
  const overlaps = (title: string) => {
    const t = norm(title);
    if (!t) return false;
    return known.some(k => k === t || (k.length > 3 && t.includes(k)) || (t.length > 3 && k.includes(t)));
  };
  return directions.map(d => ({ ...d, kind: overlaps(d.title) ? 'core' : 'adjacency' } as Direction));
}

/** Empty when the report already contains an adjacency, otherwise says so plainly. */
export function adjacencyNote(directions: Direction[]): string {
  if (directions.some(d => d.kind === 'adjacency')) return '';
  return 'Every direction here overlaps a role fit already on file, so nothing in this run counts as a genuinely new adjacency. Add more experience or projects and run it again.';
}

const SYSTEM = `You are a blunt, well informed career adviser. The person you are advising does not know what
he should do for work or what he is qualified for. Vague encouragement is a failure. So is flattery.

Rules you must follow:
1. Every claim that he fits something must cite concrete evidence from his actual line items. Put short
   quotes or close paraphrases of those line items in "evidence". A direction with no evidence must either
   be dropped or given a low "fit" and honest gaps.
2. Rank the directions best first, and score "fit" from 0 to 1. Use low scores where they are deserved.
3. At least one direction must be an adjacency he probably has not considered: something his evidence
   supports but that is not in the role fits already on file. Mark it "kind": "adjacency".
4. Respect the preference intake absolutely. Never recommend an industry he refuses, pay below his floor,
   or a work mode he did not pick. If his preferences rule out an otherwise strong direction, say that in
   "honest_note".
5. "gaps" are the honest reasons he might not get hired for it today. Be specific.
6. "pay" is a realistic pay range and what moves it. "demand" is how much hiring there is and where.
7. "next_step" is one concrete action he could take this week.
8. "titles" are the real job posting titles to search for. "industries" are the industries that hire them.

Write in plain prose. No em dashes, no en dashes.

Respond with ONLY this JSON:
{
  "summary": "<3 sentences: what his record actually shows and what that means for his search>",
  "directions": [
    { "title": "...", "kind": "core|adjacency", "fit": 0.0,
      "why": "<why he fits, referencing his real work>",
      "evidence": ["<quote or close paraphrase of a line item>"],
      "gaps": ["..."], "pay": "...", "demand": "...", "next_step": "...",
      "titles": ["..."], "industries": ["..."],
      "role_fits": [ { "role_family": "...", "industry": "...|null", "confidence": 0.0, "rationale": "..." } ] }
  ],
  "honest_note": "<what is genuinely weak, what you could not judge, what he should not waste time on>"
}`;

const MAX_CORPUS = 13000;

function corpusFor(items: DirectionLineItem[]): string {
  const order = ['accomplishment', 'project', 'education', 'skill', 'tool', 'domain'];
  const sorted = [...items].sort((a, b) => {
    const ai = order.indexOf(a.kind), bi = order.indexOf(b.kind);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const lines = sorted.map(i => {
    const where = i.employer ? ` (${i.employer})` : i.source_ref ? ` (${String(i.source_ref).split('|')[0]})` : '';
    return `- [${i.kind}] ${i.text}${where}`;
  });
  const corpus = lines.join('\n');
  return corpus.length > MAX_CORPUS ? corpus.slice(0, MAX_CORPUS) + '\n[truncated]' : corpus;
}

export function buildDirectionPrompt(ctx: DirectionContext): ChatMessage[] {
  const p = ctx.profile;
  const certs = collectCertSignals(ctx.items);
  const fits = ctx.roleFits.slice(0, 12)
    .map(f => `- ${f.role_family}${f.industry ? ` in ${f.industry}` : ''} (confidence ${f.confidence ?? '?'})`)
    .join('\n');
  const blocks = [
    `PROFILE\n${p ? `${p.narrative ?? 'no narrative'}\nSkills: ${(p.skills ?? []).slice(0, 30).join(', ') || 'none on file'}\nDomains: ${(p.domains ?? []).slice(0, 15).join(', ') || 'none on file'}\nSeniority: ${p.seniority ?? 'unknown'}, years: ${p.total_yoe ?? 'unknown'}` : 'No derived profile yet.'}`,
    `ROLE FITS ALREADY ON FILE\n${fits || 'none'}`,
    `CREDENTIALS FOUND IN HIS RECORD\n${certs.length ? certs.map(c => `- ${c}`).join('\n') : 'none found, treat him as holding no formal certifications'}`,
    `PREFERENCE INTAKE\n${describeIntake(ctx.intake)}`,
    `EXPERIENCE LINE ITEMS (${ctx.items.length} total)\n${ctx.items.length ? corpusFor(ctx.items) : 'none captured'}`,
  ];
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${blocks.join('\n\n')}\n\nGive 4 to 6 ranked directions, at least one of them an adjacency. Return the JSON.` },
  ];
}

function strs(x: any, cap = 8): string[] {
  return Array.isArray(x) ? x.filter((v: any) => typeof v === 'string' && v.trim()).map((v: string) => v.trim()).slice(0, cap) : [];
}
function unit(x: any, fallback = 0.5): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback;
}

export function parseDirectionReport(text: string): DirectionReport {
  const p = parseJsonLoose<any>(text) ?? {};
  const raw = Array.isArray(p.directions) ? p.directions : (recoverTruncatedArray(text) ?? []);
  const directions: Direction[] = raw
    .filter((d: any) => d && typeof d.title === 'string' && d.title.trim())
    .map((d: any) => ({
      title: d.title.trim(),
      kind: d.kind === 'adjacency' ? 'adjacency' : 'core',
      fit: unit(d.fit),
      why: typeof d.why === 'string' ? d.why.trim() : '',
      evidence: strs(d.evidence, 6),
      gaps: strs(d.gaps, 6),
      pay: typeof d.pay === 'string' ? d.pay.trim() : '',
      demand: typeof d.demand === 'string' ? d.demand.trim() : '',
      next_step: typeof d.next_step === 'string' ? d.next_step.trim() : '',
      titles: strs(d.titles, 8),
      industries: strs(d.industries, 8),
      role_fits: (Array.isArray(d.role_fits) ? d.role_fits : [])
        .filter((f: any) => f && typeof f.role_family === 'string' && f.role_family.trim())
        .map((f: any) => ({
          role_family: f.role_family.trim(),
          industry: typeof f.industry === 'string' && f.industry.trim() ? f.industry.trim() : null,
          confidence: unit(f.confidence),
          rationale: typeof f.rationale === 'string' ? f.rationale.trim() : '',
        }))
        .slice(0, 4),
    }))
    .sort((a: Direction, b: Direction) => b.fit - a.fit)
    .slice(0, 8);
  // A direction report with nothing in it is the one outcome the user must not
  // see as a blank card, so it fails loudly instead.
  if (!directions.length) {
    throw new Error('The model returned no usable directions. Check the LLM connection on the Dashboard and try again.');
  }
  return {
    summary: typeof p.summary === 'string' ? p.summary.trim() : '',
    directions,
    honest_note: typeof p.honest_note === 'string' ? p.honest_note.trim() : '',
    adjacency_note: '',
  };
}

/** Search parameters in the same shape the Search tab saves, built from a direction plus the intake. */
export function directionToSearchParams(direction: Direction, intake: IntakeAnswers): Record<string, any> {
  const titles = direction.titles.length ? direction.titles : [direction.title];
  const avoid = splitList(intake.industries_avoid);
  return {
    tags: titles.join(', '),
    roleFamily: direction.title,
    keyword: '',
    excludeKeyword: avoid.join(', '),
    workModes: Array.isArray(intake.work_mode) ? intake.work_mode : [],
    sort: 'fit',
    locText: typeof intake.location === 'string' ? intake.location : '',
    payMin: typeof intake.pay_floor === 'number' ? intake.pay_floor : 0,
    radiusMi: 50,
    location: null,
  };
}

export function directionSearchName(direction: Direction): string {
  const name = `Direction: ${direction.title}`;
  return name.length > 60 ? name.slice(0, 59) + '…' : name;
}
