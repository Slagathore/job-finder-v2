import type { ChatMessage } from '../llm/provider';
import { parseJsonLoose } from '../lib/json';

// Pure interview-prep prompt + parser — no electron/db imports (testable).

export interface PrepDoc { questions: string[]; stories: { q: string; a: string }[]; askThem: string[]; }

const SYSTEM = `Prepare a candidate for an interview using ONLY their real experience line items.
If SAVED STORIES are provided, reuse and adapt the ones that fit this role instead of inventing new
angles for the same experiences — refine wording to this job, keep the substance.
Respond with ONLY this JSON (no prose):
{
  "questions": ["<likely interview questions for this role>"],
  "stories": [ { "q": "<behavioral prompt>", "a": "<a STAR-style talking point drawn from their line items>" } ],
  "askThem": ["<smart questions for the candidate to ask the interviewer>"]
}`;

export function buildPrepPrompt(
  job: { title: string; company: string; description?: string | null },
  items: { kind: string; text: string }[],
  bank: { prompt: string; story: string }[] = []
): ChatMessage[] {
  const jd = (job.description ?? '').slice(0, 4000);
  const lines = items.map(i => `- (${i.kind}) ${i.text}`).join('\n');
  const saved = bank.map(s => `- Q: ${s.prompt}\n  A: ${s.story}`).join('\n');
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `JOB: ${job.title} @ ${job.company}\n${jd}\n\nLINE ITEMS:\n${lines || '(none)'}${saved ? `\n\nSAVED STORIES (reuse where they fit):\n${saved}` : ''}\n\nReturn the prep JSON.` },
  ];
}

export function parsePrep(text: string): PrepDoc {
  const p = parseJsonLoose<any>(text) ?? {};
  const strs = (x: any) => (Array.isArray(x) ? x.filter((s: any) => typeof s === 'string') : []);
  const stories = Array.isArray(p.stories) ? p.stories
    .filter((s: any) => s && typeof s.q === 'string' && typeof s.a === 'string')
    .map((s: any) => ({ q: s.q, a: s.a })) : [];
  return { questions: strs(p.questions), stories, askThem: strs(p.askThem) };
}
