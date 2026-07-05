import type { ChatMessage } from '../llm/provider';
import { parseJsonLoose, stripThinking } from '../lib/json';
import { TOOL_SPECS, TOOL_NAMES } from './tools';

export interface PlanStep { tool: string; args: Record<string, any>; reason?: string; }
export interface Plan { summary: string; steps: PlanStep[]; }
export interface ParsedPlan {
  intent: 'valid' | 'explanation' | 'malformed';
  plan?: Plan;
  explanation?: string;
  error?: string;
}

export function plannerSystemPrompt(): string {
  const tools = TOOL_SPECS.map(t => `- ${t.name} ${t.args} — ${t.description}`).join('\n');
  return `You are the assistant embedded in "Job Finder", a desktop job-search app. You can DO things
in the app by emitting a plan of tool calls, or just answer in prose when the user only wants info.

When the user asks you to DO something, reply with a one-line explanation then a single fenced
\`\`\`json block:
{ "summary": "<one sentence>", "steps": [ { "tool": "<name>", "args": { ... }, "reason": "<why>" } ] }

Available tools (use ONLY these):
${tools}

Rules:
- Prefer the fewest steps that accomplish the request.
- There is NO "apply" tool — applying is always done by the user manually.
- End a search/discover plan with an openTab to "search" so results are visible.
- If you only need to explain, OMIT the JSON entirely.`;
}

export function buildPlannerPrompt(message: string, context: string, history: ChatMessage[] = []): ChatMessage[] {
  return [
    { role: 'system', content: plannerSystemPrompt() },
    { role: 'system', content: `Current app context:\n${context}` },
    ...history,
    { role: 'user', content: message },
  ];
}

export function parsePlan(text: string): ParsedPlan {
  const cleaned = stripThinking(text || '');
  const p = parseJsonLoose<any>(text);

  if (!p || typeof p !== 'object' || !Array.isArray(p.steps)) {
    const looksLikeAttempt = /```|"steps"\s*:|"summary"\s*:/.test(cleaned);
    if (!looksLikeAttempt) return { intent: 'explanation', explanation: cleaned };
    return { intent: 'malformed', error: 'No valid plan JSON found.' };
  }

  const steps: PlanStep[] = [];
  for (let i = 0; i < p.steps.length; i++) {
    const s = p.steps[i];
    if (!s || typeof s.tool !== 'string') return { intent: 'malformed', error: `Step ${i} missing tool.` };
    if (!TOOL_NAMES.has(s.tool)) return { intent: 'malformed', error: `Step ${i}: unknown tool "${s.tool}".` };
    steps.push({ tool: s.tool, args: s.args && typeof s.args === 'object' ? s.args : {}, reason: s.reason });
  }
  return { intent: 'valid', plan: { summary: typeof p.summary === 'string' ? p.summary : '', steps } };
}
