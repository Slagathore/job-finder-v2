import { generate, type ChatMessage } from '../llm/provider';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { buildPlannerPrompt, parsePlan, type PlanStep, type ParsedPlan } from './planner';
import { capabilityOf, tabFor } from './tools';
import { appendAudit } from './audit';
import { search, discover, gradeJob } from '../discovery/service';
import { runScan } from '../scan/runner';
import { geocodeJobs } from '../geo/geocode';
import { runTailor } from '../apply/run';
import { learnSite } from '../boards/learn';
import { saveAdapter } from '../boards/store';
import { detectApi } from '../scan/ats';
import { digestSource } from '../experience/digest';
import { insertItems, getProfile, getRoleFits, saveProfile, replaceRoleFits } from '../experience/store';
import { inferProfileAndRoles } from '../experience/profile';

export interface StepResult {
  tool: string; ok: boolean; summary: string; error?: string; data?: any; openTab?: string;
  needsConfirm?: boolean; args?: any;
}

// ── Context for the planner ──────────────────────────────────────────────────

function loadContext(): string {
  const db = getDb();
  const profile = getProfile();
  const roles = getRoleFits().slice(0, 8).map((r: any) => r.role_family);
  const rules = (db.prepare('SELECT text FROM user_rules').all() as { text: string }[]).map(r => r.text);
  const mems = (db.prepare('SELECT key, value FROM agent_memory ORDER BY id DESC LIMIT 10').all() as any[])
    .map(m => `${m.key}=${m.value}`);
  const jobs = (db.prepare('SELECT COUNT(*) n FROM jobs').get() as { n: number }).n;
  return [
    `Jobs in DB: ${jobs}.`,
    `Profile: ${profile?.narrative ?? 'not yet inferred'} (seniority ${profile?.seniority ?? '?'}).`,
    `Role families: ${roles.join(', ') || 'none'}.`,
    `Rules: ${rules.join(' | ') || 'none'}.`,
    `Memory: ${mems.join(' | ') || 'none'}.`,
  ].join('\n');
}

// ── Permissions ──────────────────────────────────────────────────────────────

export function getPermissions(): { capability: string; mode: string }[] {
  return getDb().prepare('SELECT capability, mode FROM capability_permissions ORDER BY capability').all() as any[];
}
export function setPermission(capability: string, mode: string): void {
  getDb().prepare('INSERT INTO capability_permissions(capability,mode) VALUES(?,?) ON CONFLICT(capability) DO UPDATE SET mode=excluded.mode')
    .run(capability, mode);
}
function modeFor(capability: string | null | undefined): string {
  if (!capability) return 'auto';
  const row = getDb().prepare('SELECT mode FROM capability_permissions WHERE capability = ?').get(capability) as { mode: string } | undefined;
  return row?.mode ?? 'auto';
}

export function listMemory(): any[] {
  return getDb().prepare('SELECT * FROM agent_memory ORDER BY id DESC LIMIT 50').all();
}

// ── Planning ─────────────────────────────────────────────────────────────────

export async function planMessage(message: string, history: ChatMessage[] = []): Promise<ParsedPlan & { raw?: string }> {
  try {
    const r = await generate(readSettings(), buildPlannerPrompt(message, loadContext(), history), { temperature: 0.3, maxTokens: 2500 });
    return { ...parsePlan(r.text), raw: r.text };
  } catch (e: any) {
    return { intent: 'malformed', error: e?.message ?? String(e) };
  }
}

// ── Execution ────────────────────────────────────────────────────────────────

async function executeStep(step: PlanStep, confirmed = false): Promise<StepResult> {
  const cap = capabilityOf(step.tool);
  const mode = modeFor(cap);
  if (mode === 'off') {
    return { tool: step.tool, ok: false, summary: '', error: `blocked: capability "${cap}" is off` };
  }
  if (mode === 'confirm' && !confirmed) {
    return { tool: step.tool, ok: false, needsConfirm: true, args: step.args, summary: `awaiting your confirmation (${cap})` };
  }
  const a = step.args || {};
  const db = getDb();
  appendAudit('agent', step.tool, a);
  const tab = tabFor(step.tool);

  switch (step.tool) {
    case 'search': {
      const r = await search(a);
      return { tool: step.tool, ok: true, summary: `${r.results.length} results`, data: r.results.slice(0, 20), openTab: tab };
    }
    case 'discover': {
      const r = await discover(40);
      return { tool: step.tool, ok: true, summary: r.note ?? `${r.results.length} surfaced`, data: r.results.slice(0, 20), openTab: tab };
    }
    case 'scanBoards': {
      const s = await runScan('agent');
      return { tool: step.tool, ok: true, summary: `+${s.added} new (${s.found} found, ${s.scanned} boards)` };
    }
    case 'geocodeJobs': {
      const r = await geocodeJobs(Number(a.limit) || 80);
      return { tool: step.tool, ok: true, summary: `geocoded ${r.resolved}, ${r.remaining} remaining` };
    }
    case 'gradeJob': {
      const r = await gradeJob(Number(a.jobId));
      return { tool: step.tool, ok: !('error' in r), summary: 'error' in r ? '' : `grade ${r.grade}`, error: 'error' in r ? r.error : undefined };
    }
    case 'tailor': {
      const r = await runTailor(Number(a.jobId));
      return 'error' in r ? { tool: step.tool, ok: false, summary: '', error: r.error }
        : { tool: step.tool, ok: true, summary: `tailored (${r.bullets} bullets)`, data: { cv: r.cv, cover: r.cover } };
    }
    case 'addBoard': {
      const api = detectApi({ name: a.name, url: a.url });
      db.prepare('INSERT INTO boards (name, type, url, enabled, ingress, status, created_at) VALUES (?,?,?,1,?,?,?)')
        .run(a.name ?? a.url, 'ats', a.url, api ? 'api' : 'unknown', api ? api.type : 'no-api', Date.now());
      return { tool: step.tool, ok: true, summary: `added board${api ? ` (${api.type})` : ''}`, openTab: tab };
    }
    case 'learnBoard': {
      const r = await learnSite(readSettings(), a.url);
      if ('error' in r) return { tool: step.tool, ok: false, summary: '', error: r.error };
      saveAdapter(a.url, r.adapter, r.count);
      return { tool: step.tool, ok: true, summary: `learned adapter (${r.count} jobs)`, openTab: tab };
    }
    case 'digestText': {
      const items = await digestSource(readSettings(), a.text ?? '', 'agent');
      const added = insertItems(items.map(i => ({ ...i, source_ref: 'agent' } as any)));
      return { tool: step.tool, ok: true, summary: `+${added} line items`, openTab: tab };
    }
    case 'inferProfile': {
      const items = db.prepare('SELECT kind, text, role, employer, start_date, end_date, metrics, seniority_signal FROM experience_items').all() as any[];
      if (!items.length) return { tool: step.tool, ok: false, summary: '', error: 'no experience to analyze' };
      const { profile, roleFits } = await inferProfileAndRoles(readSettings(), items);
      saveProfile(profile); replaceRoleFits(roleFits);
      return { tool: step.tool, ok: true, summary: `profile + ${roleFits.length} role fits`, openTab: tab };
    }
    case 'setRule': {
      db.prepare('INSERT INTO user_rules (scope, text, source, created_at) VALUES (?,?,?,?)')
        .run(a.scope ?? 'resume', a.text ?? '', 'agent', Date.now());
      return { tool: step.tool, ok: true, summary: `rule added (${a.scope ?? 'resume'})` };
    }
    case 'blockCompany': {
      const norm = String(a.name ?? '').toLowerCase().trim();
      if (norm) db.prepare('INSERT INTO company_blocklist (normalized_name, reason) VALUES (?,?) ON CONFLICT(normalized_name) DO NOTHING')
        .run(norm, a.reason ?? 'agent');
      return { tool: step.tool, ok: true, summary: `blocked ${a.name}` };
    }
    case 'remember': {
      db.prepare('INSERT INTO agent_memory (kind, key, value, created_at) VALUES (?,?,?,?)')
        .run('fact', a.key ?? 'note', a.value ?? '', Date.now());
      return { tool: step.tool, ok: true, summary: `remembered ${a.key}` };
    }
    case 'openTab':
      return { tool: step.tool, ok: true, summary: `open ${a.tab}`, openTab: a.tab };
    case 'note':
      return { tool: step.tool, ok: true, summary: a.text ?? '' };
    default:
      return { tool: step.tool, ok: false, summary: '', error: `unhandled tool ${step.tool}` };
  }
}

export async function runPlan(steps: PlanStep[]): Promise<{ results: StepResult[] }> {
  const results: StepResult[] = [];
  for (const step of steps) {
    try { results.push(await executeStep(step)); }
    catch (e: any) { results.push({ tool: step.tool, ok: false, summary: '', error: e?.message ?? String(e) }); }
  }
  return { results };
}

/** Execute a single confirm-gated step after the user approves it. */
export async function runStep(step: PlanStep): Promise<StepResult> {
  try { return await executeStep(step, true); }
  catch (e: any) { return { tool: step.tool, ok: false, summary: '', error: e?.message ?? String(e) }; }
}
