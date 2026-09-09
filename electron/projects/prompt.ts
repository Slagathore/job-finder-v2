/**
 * Prompt building and parsing for project ingestion (pure — no db, fs or
 * electron imports, so vitest can load it).
 *
 * A "project" here is one repo, one local folder, or one deployed web app. The
 * output is the same shape as every other experience line item, so tailoring
 * picks projects and jobs from one pool.
 */

import type { ChatMessage } from '../llm/provider';
import { parseLineItems, type LineItem } from '../experience/digest';
import type { SourceFile } from './filter';

export type { ProjectDepth } from './resume-rule';

export interface ProjectFacts {
  /** Display name, e.g. "Slagathore/sparkles-mtg-meta" or a folder basename. */
  name: string;
  description?: string | null;
  url?: string | null;
  isPrivate?: boolean;
  language?: string | null;
  languages?: Record<string, number> | null;
  pushedAt?: string | null;
  readme?: string | null;
  manifestName?: string | null;
  manifest?: string | null;
  tree?: string[] | null;
}

const SYSTEM = `You turn a software project into atomic, reusable RESUME LINE ITEMS for its author.

You are reading the project's own files. Describe what the author actually built and what it
demonstrates. Never invent users, revenue, team size, employers or dates that the material does
not show. If the project is a toy or a stub, say so in plain terms rather than inflating it.

Respond with ONLY a JSON array (no prose, no code fence) of objects:
[
  {
    "kind": "project" | "accomplishment" | "skill" | "tool" | "domain",
    "text": "<the line item, self-contained and readable on a resume>",
    "role": null,
    "employer": null,
    "start_date": null,
    "end_date": null,
    "metrics": "<a real number the material supports, else null>",
    "seniority_signal": "junior" | "mid" | "senior" | "lead" | null
  }
]

Rules:
- Exactly one item of kind "project": a two sentence summary of what the project is and what is
  technically notable about it. Put the project name in that text.
- Then the specifics: kind "accomplishment" for things the author built or solved, kind "tool"
  for each concrete technology used, kind "skill" for each capability demonstrated, kind "domain"
  for the problem space.
- Between 6 and 18 items total. One idea per item. No duplicates.
- Plain prose. No em dashes. No marketing language.`;

const CHUNK_SYSTEM = `You are reading part of the source of one software project so that a later
step can write resume line items about it.

Write terse notes on what THIS code does: the components and their responsibilities, the
techniques and algorithms used, the external services and libraries relied on, anything that
took real engineering (concurrency, parsing, native modules, security, performance work, data
modelling, protocol handling). Note scale signals such as table counts, endpoint counts or
file counts if they are visible.

Facts only, as a short bullet list. No preamble. No praise. Do not invent anything.`;

const SYNTHESIS_SYSTEM = SYSTEM + `

You are given notes taken while reading the project's actual source code, in addition to its
metadata. Prefer the source notes over the README: the README is marketing, the code is evidence.`;

function clip(text: string | null | undefined, max: number): string {
  const t = String(text ?? '');
  return t.length > max ? t.slice(0, max) + '\n...[truncated]' : t;
}

/** The metadata sheet every project digest starts from. */
export function buildFactSheet(f: ProjectFacts): string {
  const parts: string[] = [`Project: ${f.name}`];
  if (f.isPrivate != null) parts.push(`Visibility: ${f.isPrivate ? 'private' : 'public'}`);
  if (f.description) parts.push(`Description: ${f.description}`);
  if (f.url) parts.push(`URL: ${f.url}`);
  if (f.language) parts.push(`Primary language: ${f.language}`);
  if (f.languages && Object.keys(f.languages).length) {
    const total = Object.values(f.languages).reduce((a, b) => a + b, 0) || 1;
    const breakdown = Object.entries(f.languages)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`)
      .join(', ');
    parts.push(`Language breakdown: ${breakdown}`);
  }
  if (f.pushedAt) parts.push(`Last pushed: ${f.pushedAt}`);
  if (f.tree?.length) parts.push(`Top level files:\n${f.tree.slice(0, 80).map(t => `- ${t}`).join('\n')}`);
  if (f.manifest) parts.push(`${f.manifestName ?? 'Manifest'}:\n${clip(f.manifest, 4000)}`);
  if (f.readme) parts.push(`README:\n${clip(f.readme, 12_000)}`);
  return parts.join('\n\n');
}

/** Medium dive: metadata, README, manifest and top level tree only. */
export function buildMediumPrompt(f: ProjectFacts): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${buildFactSheet(f)}\n\nWrite the line items as a JSON array.` },
  ];
}

/** One chunk of source files, summarized into notes. */
export function buildChunkPrompt(projectName: string, files: SourceFile[]): ChatMessage[] {
  const body = files
    .map(fl => `----- ${fl.path} -----\n${fl.text}`)
    .join('\n\n');
  return [
    { role: 'system', content: CHUNK_SYSTEM },
    { role: 'user', content: `Project: ${projectName}\n\n${body}` },
  ];
}

/** Deep dive: the fact sheet plus the notes taken while reading the source. */
export function buildDeepPrompt(f: ProjectFacts, notes: string[]): ChatMessage[] {
  const noteBlock = notes.map((n, i) => `--- source notes ${i + 1} ---\n${clip(n, 6000)}`).join('\n\n');
  return [
    { role: 'system', content: SYNTHESIS_SYSTEM },
    {
      role: 'user',
      content: `${buildFactSheet(f)}\n\n${noteBlock}\n\nWrite the line items as a JSON array.`,
    },
  ];
}

const PROJECT_KINDS = new Set(['project', 'accomplishment', 'skill', 'tool', 'domain']);

/**
 * Parse the model's line items for a project.
 *
 * A response with nothing usable in it throws rather than returning an empty
 * array: a repo that silently produces zero items looks identical to a repo the
 * app never got to, and the per-repo state would lie about it.
 */
export function parseProjectItems(llmText: string, projectName: string): LineItem[] {
  const raw = parseLineItems(llmText);
  const seen = new Set<string>();
  const out: LineItem[] = [];
  for (const item of raw) {
    if (!PROJECT_KINDS.has(item.kind)) continue;
    const key = `${item.kind}::${item.text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Projects are not employment, so employer/role stay empty and the project
    // name rides in source_ref instead of being faked into an employer column.
    out.push({ ...item, employer: null, role: null });
  }
  if (!out.length) {
    throw new Error(
      `The model returned no usable line items for ${projectName}. Check the LLM connection on the Dashboard and try again.`
    );
  }
  return out;
}

/**
 * Percent complete for a scan, clamped and integral so the bar behaves.
 * `fraction` (0-1) is how far through the *current* item we are, so a single
 * long-running item (a repo deep dive) can move the bar instead of holding it
 * flat at the same whole-item count until the item finishes.
 */
export function progressPercent(done: number, total: number, fraction = 0): number {
  if (!total || total < 0) return 0;
  const frac = Math.max(0, Math.min(1, fraction));
  return Math.max(0, Math.min(100, Math.round(((done + frac) / total) * 100)));
}
