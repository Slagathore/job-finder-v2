/**
 * Portfolio evaluator: prompt building and parsing (pure, no db or electron
 * imports, so vitest can load it).
 *
 * The input is the kind='project' experience line items produced by the project
 * ingestion subsystem. Several line items usually come from one repo, so they
 * are clustered by source_ref before the model sees them: the question being
 * answered is "what does this project prove", not "what does this bullet say".
 */

import { createHash } from 'crypto';
import type { ChatMessage } from '../llm/provider';
import { parseJsonLoose, recoverTruncatedArray } from '../lib/json';
import { strList } from './parse';

export interface ProjectLineItem {
  id?: number;
  text: string;
  source_ref?: string | null;
  role?: string | null;
  employer?: string | null;
}

export interface ProjectCluster {
  /** The raw source_ref this cluster came from, or '' for loose items. */
  source: string;
  /** Display name, e.g. 'Slagathore/job_finder_v2'. */
  label: string;
  lines: string[];
}

/** Human label for a source_ref like 'github:owner/repo' or 'folder:C:\code\x'. */
export function sourceLabel(ref: string): string {
  if (!ref) return 'Unfiled work';
  const i = ref.indexOf(':');
  const rest = i >= 0 ? ref.slice(i + 1) : ref;
  const tail = rest.split(/[\\/]/).filter(Boolean);
  if (ref.startsWith('github:')) return rest;
  return tail.slice(-2).join('/') || rest;
}

/**
 * Group project line items by their first source_ref. Merged items carry a
 * pipe-joined provenance string, and the first ref is the one that produced
 * the item, so that is the cluster it belongs in.
 */
export function clusterProjectItems(items: ProjectLineItem[]): ProjectCluster[] {
  const by = new Map<string, ProjectCluster>();
  for (const it of items) {
    if (!it || typeof it.text !== 'string' || !it.text.trim()) continue;
    const ref = String(it.source_ref ?? '').split('|').filter(Boolean)[0] ?? '';
    const key = ref || '';
    let c = by.get(key);
    if (!c) { c = { source: key, label: sourceLabel(key), lines: [] }; by.set(key, c); }
    c.lines.push(it.text.trim());
  }
  return Array.from(by.values()).sort((a, b) => b.lines.length - a.lines.length);
}

/** Fingerprint of the portfolio, so a cached review is reused only while the portfolio is unchanged. */
export function portfolioSignature(items: ProjectLineItem[]): string {
  const parts = items
    .map(i => `${i.id ?? ''}:${String(i.source_ref ?? '')}:${(i.text ?? '').length}`)
    .sort();
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

export interface PortfolioProject {
  project: string;
  source: string | null;
  proves: string;
  roles: string[];
  industries: string[];
  resume_line: string;
  weaknesses: string[];
  strength: string;
}
export interface PortfolioTheme { theme: string; evidence: string[]; sells_to: string[]; }
export interface PortfolioGap { gap: string; why: string; first_step: string; }
export interface PortfolioReview {
  summary: string;
  projects: PortfolioProject[];
  themes: PortfolioTheme[];
  gap: PortfolioGap | null;
}

const SYSTEM = `You assess a candidate's portfolio as a job-search asset. You are given projects, each with
the line items ingested from its repository or folder. Judge only what the evidence supports. If a project
proves very little, say so plainly. Flattery is worse than useless here.

For EACH project or cluster report:
- "proves": what it demonstrably shows about the person's ability, in one or two sentences
- "roles": the job titles it is genuine evidence for
- "industries": the industries where that evidence carries weight
- "resume_line": exactly one resume line, under 30 words, written to be pasted as is
- "weaknesses": what is missing, thin, or unproven about it
- "strength": low, medium or high, how much hiring weight it actually carries

Then across the whole portfolio:
- "themes": the two or three strongest recurring themes, each with the projects that evidence it
  ("evidence") and the roles or industries it sells to ("sells_to")
- "gap": the single most valuable gap to fill next, why it matters, and the first concrete step

Write in plain prose. No em dashes, no en dashes.

Respond with ONLY this JSON:
{
  "summary": "<2 sentence honest read of the portfolio as a whole>",
  "projects": [ { "project": "...", "source": "...|null", "proves": "...", "roles": ["..."],
                  "industries": ["..."], "resume_line": "...", "weaknesses": ["..."],
                  "strength": "low|medium|high" } ],
  "themes": [ { "theme": "...", "evidence": ["..."], "sells_to": ["..."] } ],
  "gap": { "gap": "...", "why": "...", "first_step": "..." }
}`;

const MAX_CHARS = 12000;

export function buildPortfolioPrompt(clusters: ProjectCluster[], profile: any): ChatMessage[] {
  const blocks = clusters.map(c => `## ${c.label}${c.source ? ` (${c.source})` : ''}\n${c.lines.map(l => `- ${l}`).join('\n')}`);
  let corpus = blocks.join('\n\n');
  if (corpus.length > MAX_CHARS) corpus = corpus.slice(0, MAX_CHARS) + '\n[truncated]';
  const skills = (profile?.skills ?? []).slice(0, 25).join(', ');
  const context = profile
    ? `Candidate positioning: ${profile.narrative ?? 'n/a'}\nSkills on file: ${skills || 'n/a'}\nSeniority: ${profile.seniority ?? 'unknown'}`
    : 'No derived profile yet, judge the projects on their own.';
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${context}\n\nProjects:\n\n${corpus}\n\nProduce the portfolio review JSON.` },
  ];
}

function project(raw: any): PortfolioProject {
  return {
    project: String(raw?.project ?? '').trim(),
    source: typeof raw?.source === 'string' && raw.source.trim() ? raw.source.trim() : null,
    proves: typeof raw?.proves === 'string' ? raw.proves.trim() : '',
    roles: strList(raw?.roles, 8),
    industries: strList(raw?.industries, 8),
    resume_line: typeof raw?.resume_line === 'string' ? raw.resume_line.trim() : '',
    weaknesses: strList(raw?.weaknesses, 6),
    strength: ['low', 'medium', 'high'].includes(raw?.strength) ? raw.strength : 'medium',
  };
}

export function parsePortfolioReview(text: string): PortfolioReview {
  const p = parseJsonLoose<any>(text) ?? {};
  const rawProjects = Array.isArray(p.projects) ? p.projects : (recoverTruncatedArray(text) ?? []);
  const projects = rawProjects
    .filter((x: any) => x && typeof x.project === 'string' && x.project.trim())
    .map(project)
    .slice(0, 20);
  const themes: PortfolioTheme[] = (Array.isArray(p.themes) ? p.themes : [])
    .filter((t: any) => t && typeof t.theme === 'string' && t.theme.trim())
    .map((t: any) => ({ theme: t.theme.trim(), evidence: strList(t.evidence, 8), sells_to: strList(t.sells_to, 8) }))
    .slice(0, 5);
  const g = p.gap;
  const gap: PortfolioGap | null = g && typeof g.gap === 'string' && g.gap.trim()
    ? { gap: g.gap.trim(), why: String(g.why ?? '').trim(), first_step: String(g.first_step ?? '').trim() }
    : null;
  // A blank card looks exactly like a dead button, so an unusable response has
  // to surface as an error the user can act on.
  if (!projects.length && !themes.length) {
    throw new Error('The model returned no usable portfolio review. Check the LLM connection on the Dashboard and try again.');
  }
  return { summary: typeof p.summary === 'string' ? p.summary.trim() : '', projects, themes, gap };
}
