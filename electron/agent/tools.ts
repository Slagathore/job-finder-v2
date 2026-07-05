/**
 * Agent tool registry (PLAN.md §6.12). Each tool maps to an existing app action
 * and carries a capability key for the permission matrix. Pure metadata —
 * handlers live in run.ts. NOTE: there is intentionally NO "apply" tool;
 * applying stays user-driven (capability apply=off).
 */
export interface ToolSpec {
  name: string;
  capability: string | null;   // null = always allowed (navigation/notes)
  args: string;                // human/LLM hint of the args shape
  description: string;
  tab?: string;                // tab whose results this populates (push-to-tab)
}

export const TOOL_SPECS: ToolSpec[] = [
  { name: 'search', capability: 'search', tab: 'search', args: '{ tags?, roleFamily?, workModes?: string[], payMin?, keyword? }', description: 'Semantic + filtered job search; results shown in Search.' },
  { name: 'discover', capability: 'search', tab: 'search', args: '{}', description: 'Surface best-fit jobs you did not explicitly search for.' },
  { name: 'scanBoards', capability: 'harvest', args: '{}', description: 'Scan all enabled ATS/boards for new jobs.' },
  { name: 'geocodeJobs', capability: 'harvest', args: '{ limit? }', description: 'Geocode job locations for radius search.' },
  { name: 'gradeJob', capability: 'score', args: '{ jobId }', description: 'LLM A–F fit grade for one job.' },
  { name: 'tailor', capability: 'tailor_doc', args: '{ jobId }', description: 'Generate a tailored CV + cover letter for a job.' },
  { name: 'addBoard', capability: 'learn_boards', tab: 'boards', args: '{ name, url }', description: 'Add a job board / company careers URL.' },
  { name: 'learnBoard', capability: 'learn_boards', tab: 'boards', args: '{ url }', description: 'Learn DOM selectors for a non-ATS careers page.' },
  { name: 'digestText', capability: 'digest_experience', tab: 'experience', args: '{ text }', description: 'Digest pasted experience text into line items.' },
  { name: 'inferProfile', capability: 'digest_experience', tab: 'experience', args: '{}', description: 'Re-infer profile + role fits from experience.' },
  { name: 'setRule', capability: 'set_rules', args: '{ scope, text }', description: 'Add a tailoring/search rule.' },
  { name: 'blockCompany', capability: 'edit_profile', args: '{ name, reason? }', description: 'Add a company to the never-apply blocklist.' },
  { name: 'remember', capability: 'edit_profile', args: '{ key, value }', description: 'Store a long-term fact/preference in agent memory.' },
  { name: 'openTab', capability: null, args: '{ tab }', description: 'Switch the app to a tab (dashboard/search/pipeline/experience/boards/agent/settings).' },
  { name: 'note', capability: null, args: '{ text }', description: 'Show an informational note to the user.' },
];

export const TOOL_NAMES = new Set(TOOL_SPECS.map(t => t.name));
export function capabilityOf(name: string): string | null | undefined {
  return TOOL_SPECS.find(t => t.name === name)?.capability;
}
export function tabFor(name: string): string | undefined {
  return TOOL_SPECS.find(t => t.name === name)?.tab;
}
