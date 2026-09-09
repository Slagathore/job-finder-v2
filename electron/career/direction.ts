/**
 * Career direction deep dive: the db side.
 *
 * Three jobs here. Persist the preference intake so it is never asked twice.
 * Run the synthesis over everything on file and persist the report so it
 * survives a restart. Then turn a chosen direction into real saved searches or
 * role fits, with every write previewed first and undoable afterwards. Nothing
 * here overwrites the profile and nothing deletes an existing saved search.
 */

import { generate } from '../llm/provider';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { getProfile, getRoleFits, addRoleFits } from '../experience/store';
import { appendAudit } from '../agent/audit';
import {
  INTAKE_QUESTIONS, missingLabels, missingRequired, normalizeIntake, type IntakeAnswers,
} from './intake';
import {
  adjacencyNote, buildDirectionPrompt, directionSearchName, directionToSearchParams,
  markAdjacencies, parseDirectionReport, type Direction, type DirectionReport,
} from './direction-prompt';

export interface IntakeState {
  questions: typeof INTAKE_QUESTIONS;
  answers: IntakeAnswers;
  missing: string[];
  missingLabels: string[];
  updatedAt: number | null;
}

export function getIntake(): IntakeState {
  const row = getDb().prepare('SELECT answers, updated_at FROM career_intake WHERE id = 1').get() as any;
  let answers: IntakeAnswers = {};
  if (row) { try { answers = normalizeIntake(JSON.parse(row.answers)); } catch { answers = {}; } }
  const missing = missingRequired(answers);
  return { questions: INTAKE_QUESTIONS, answers, missing, missingLabels: missingLabels(missing), updatedAt: row?.updated_at ?? null };
}

/** Save the intake. Revisable: this replaces the single row, never appends duplicates. */
export function saveIntake(raw: any): IntakeState {
  const answers = normalizeIntake(raw);
  getDb().prepare(
    'INSERT INTO career_intake (id, answers, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET answers = excluded.answers, updated_at = excluded.updated_at'
  ).run(JSON.stringify(answers), Date.now());
  return getIntake();
}

export interface StoredDirection {
  report: DirectionReport;
  itemCount: number;
  createdAt: number;
}

function readReport(): StoredDirection | null {
  const row = getDb().prepare('SELECT report, item_count, created_at FROM career_direction ORDER BY id DESC LIMIT 1').get() as any;
  if (!row) return null;
  try { return { report: JSON.parse(row.report), itemCount: row.item_count, createdAt: row.created_at }; }
  catch { return null; }
}

export function getDirection(): StoredDirection | null { return readReport(); }

function listItems() {
  return getDb().prepare(
    'SELECT id, kind, text, employer, source_ref FROM experience_items ORDER BY id'
  ).all() as { id: number; kind: string; text: string; employer: string | null; source_ref: string | null }[];
}

/** Run the synthesis. Refuses to guess: the intake has to be finished first. */
export async function runDirection(force = false): Promise<StoredDirection | { error: string }> {
  const intake = getIntake();
  if (intake.missing.length) {
    return { error: `Finish the preference intake first. Still needed: ${intake.missingLabels.join(', ')}.` };
  }
  const items = listItems();
  if (!items.length) {
    return { error: 'No experience on file yet. Import a resume or scan your projects on the Experience tab, then run this.' };
  }
  if (!force) {
    const existing = readReport();
    if (existing) return existing;
  }

  const roleFits = getRoleFits();
  try {
    const r = await generate(
      readSettings(),
      buildDirectionPrompt({ profile: getProfile(), items, roleFits, intake: intake.answers }),
      { temperature: 0.4, maxTokens: 12000 },
    );
    const parsed = parseDirectionReport(r.text);
    const directions = markAdjacencies(parsed.directions, roleFits.map((f: any) => f.role_family));
    const report: DirectionReport = { ...parsed, directions, adjacency_note: adjacencyNote(directions) };
    const now = Date.now();
    const db = getDb();
    db.prepare('INSERT INTO career_direction (report, intake, item_count, created_at) VALUES (?,?,?,?)')
      .run(JSON.stringify(report), JSON.stringify(intake.answers), items.length, now);
    db.prepare('DELETE FROM career_direction WHERE id NOT IN (SELECT id FROM career_direction ORDER BY id DESC LIMIT 5)').run();
    return { report, itemCount: items.length, createdAt: now };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

function directionAt(index: number): Direction | { error: string } {
  const stored = readReport();
  if (!stored) return { error: 'No direction report yet. Run the deep dive first.' };
  const d = stored.report.directions[index];
  return d ?? { error: 'That direction is no longer in the report. Run the deep dive again.' };
}

export interface SearchWritePlan {
  direction: string;
  name: string;
  params: Record<string, any>;
  existingNames: string[];
}
export interface SearchWriteResult { created: { id: number; name: string }[] }

/** What creating searches for this direction would do. Nothing is written. */
export function previewDirectionSearches(index: number): SearchWritePlan | { error: string } {
  const d = directionAt(index);
  if ('error' in d) return d;
  const intake = getIntake();
  const existing = (getDb().prepare('SELECT name FROM saved_searches').all() as { name: string }[]).map(r => r.name);
  return {
    direction: d.title,
    name: uniqueName(directionSearchName(d), existing),
    params: directionToSearchParams(d, intake.answers),
    existingNames: existing,
  };
}

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  for (let n = 2; n < 50; n++) {
    const candidate = `${base} (${n})`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/** Create the saved search. Existing searches are never touched. */
export function applyDirectionSearches(index: number): SearchWriteResult | { error: string } {
  const plan = previewDirectionSearches(index);
  if ('error' in plan) return plan;
  const info = getDb().prepare('INSERT INTO saved_searches (name, params, created_at) VALUES (?,?,?)')
    .run(plan.name, JSON.stringify(plan.params), Date.now());
  const created = [{ id: Number(info.lastInsertRowid), name: plan.name }];
  appendAudit('user', 'career_direction.create_search', { direction: plan.direction, created });
  return { created };
}

export interface FitWritePlan {
  direction: string;
  additions: { role_family: string; industry: string | null; confidence: number; rationale: string }[];
  alreadyPresent: string[];
}
export interface FitWriteResult { added: { id: number; role_family: string }[] }

/** What adding this direction's role fits would do. Nothing is written. */
export function previewDirectionFits(index: number): FitWritePlan | { error: string } {
  const d = directionAt(index);
  if ('error' in d) return d;
  const known = new Set((getRoleFits() as any[]).map(f => `${String(f.role_family).toLowerCase()}|${String(f.industry ?? '').toLowerCase()}`));
  const proposed = d.role_fits.length
    ? d.role_fits
    : [{ role_family: d.title, industry: d.industries[0] ?? null, confidence: d.fit, rationale: d.why }];
  const additions = proposed.filter(f => !known.has(`${f.role_family.toLowerCase()}|${String(f.industry ?? '').toLowerCase()}`));
  const alreadyPresent = proposed
    .filter(f => known.has(`${f.role_family.toLowerCase()}|${String(f.industry ?? '').toLowerCase()}`))
    .map(f => f.role_family);
  return { direction: d.title, additions, alreadyPresent };
}

/**
 * Append the direction's role fits. Append only: the existing fits and the
 * derived profile stay exactly as they were, and every new row id comes back so
 * the UI can undo precisely what it added.
 */
export function applyDirectionFits(index: number): FitWriteResult | { error: string } {
  const plan = previewDirectionFits(index);
  if ('error' in plan) return plan;
  if (!plan.additions.length) return { added: [] };
  const added = addRoleFits(plan.additions.map(f => ({
    role_family: f.role_family, industry: f.industry, taxonomy_code: null,
    confidence: f.confidence, rationale: f.rationale || `Added from the career direction report: ${plan.direction}.`,
  })));
  appendAudit('user', 'career_direction.add_role_fits', { direction: plan.direction, added });
  return { added };
}

/** Undo exactly the rows a write created. Ids that are not ours simply do not match. */
export function undoDirectionWrite(p: { searchIds?: number[]; fitIds?: number[] }): { searchesRemoved: number; fitsRemoved: number } {
  const db = getDb();
  let searchesRemoved = 0, fitsRemoved = 0;
  const delSearch = db.prepare('DELETE FROM saved_searches WHERE id = ?');
  const delFit = db.prepare('DELETE FROM role_fits WHERE id = ?');
  const tx = db.transaction(() => {
    for (const id of p.searchIds ?? []) searchesRemoved += delSearch.run(id).changes;
    for (const id of p.fitIds ?? []) fitsRemoved += delFit.run(id).changes;
  });
  tx();
  appendAudit('user', 'career_direction.undo', { searchesRemoved, fitsRemoved });
  return { searchesRemoved, fitsRemoved };
}
