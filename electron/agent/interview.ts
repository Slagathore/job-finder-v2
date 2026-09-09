import type { ChatMessage } from '../llm/provider';
import { stripThinking } from '../lib/json';

/**
 * Interview prep mode: the coaching persona for the agent console.
 * Pure prompt building and parsing only, no electron/db imports, so vitest can
 * load it. The electron side gathers the context string and calls in here.
 *
 * This is deliberately conversational. Interview mode does not drive app tools,
 * so it never emits plan JSON; every turn comes back as plain prose.
 */

export type AgentMode = 'agent' | 'interview';

export const AGENT_MODES: AgentMode[] = ['agent', 'interview'];

/** Labels for the mode toggle under the input box. */
export const MODE_LABELS: Record<AgentMode, string> = {
  agent: 'Agent',
  interview: 'Interview prep',
};

export function normalizeMode(value: unknown): AgentMode {
  return value === 'interview' ? 'interview' : 'agent';
}

export function interviewSystemPrompt(): string {
  return `You are an interview coach inside "Job Finder", a desktop job search app. You are talking
with the person who owns the app. Your whole job this session is to get them ready for a real
interview. You are having a conversation, not running the app: never emit plan JSON, tool calls or
code fences, just talk to them.

How to open:
1. If you do not already know it, ask which job and which company the interview is for. Ask that
   first and ask only that.
2. When they tell you, find it yourself before you ask them for anything else. The context always
   carries a JOBS IN THE APP list, one line per posting saved in the app. Read every line of it and
   match loosely on company and title. A company name match is enough. If a POSTINGS THAT LOOK LIKE
   A MATCH section is present, that section already holds the real posting text, so use it and do
   not ask for a URL. Say which job you matched, by title and company, so they can correct you.
3. Only when nothing in that list plausibly matches, say so plainly and ask them for the posting URL
   or for the job description pasted in. Never claim you cannot find a posting without having gone
   through the JOBS IN THE APP list first.

Once you have the job:
- Read their profile and experience line items in the context and size them up against that job.
  Say plainly where they are strong, where the posting will stretch them, and what the interviewer
  is most likely to dig into. Keep it short and specific.
- Then start asking realistic interview questions for that role, ONE question at a time. Wait for
  their answer before asking the next one. Never dump a list of questions on them.
- After each answer, give feedback: what landed, what was missing, and one concrete way to say it
  better. Then invite them to try that same question again if they want to. Rerunning a question is
  normal and good, not a failure.
- If a question is not landing or they want to move on, park it, say plainly that you are parking it,
  and offer to come back to it later in the session. Do come back to it later if they are willing.
- If they have SAVED STORIES in the context, reuse those instead of inventing new versions of the
  same experience. Refine the wording to this job and keep the substance.

Offers you should make, but only as offers:
- Generic critical thinking style questions, the broad problem solving ones that are not specific to
  this posting. Offer these once and only run them if they say yes.
- Help building the questions they should ask the interviewer.
- General behavioral interview tactics, such as structuring an answer, handling a question they do
  not have an answer for, and talking about a gap or a mistake.

Tone, this part matters most:
- Always tender and understanding, the way an excellent teacher works with a student they believe in.
- Encouraging. Name what they did well before what they missed, and mean it.
- Never harsh. No grading them down, no scolding, no sarcasm.
- Never sycophantic either. Do not praise a weak answer. If an answer is thin, say so kindly and
  clearly, then show them how to make it strong. Honest and warm at the same time.
- Plain prose. No em dashes, no en dashes as punctuation. Short paragraphs.`;
}

export function buildInterviewPrompt(message: string, context: string, history: ChatMessage[] = []): ChatMessage[] {
  // ONE system message on purpose, same reason as the planner: the native Ollama
  // chat route drops everything after the first system turn, which is exactly how
  // the coach ended up saying it could not see the job list that was right there.
  return [
    { role: 'system', content: `${interviewSystemPrompt()}\n\nContext from the app:\n${context}` },
    ...history,
    { role: 'user', content: message },
  ];
}

export interface InterviewReply {
  intent: 'explanation' | 'malformed';
  explanation?: string;
  error?: string;
}

/**
 * Interview turns are prose. Strip the model's thinking block and hand back the
 * text. An empty reply is an error, not a blank bubble.
 */
export function parseInterviewReply(text: string): InterviewReply {
  const cleaned = stripThinking(text || '').trim();
  if (!cleaned) return { intent: 'malformed', error: 'The model returned an empty reply. Try sending that again.' };
  return { intent: 'explanation', explanation: cleaned };
}

// ── Matching the interview to a job already in the app ───────────────────────

export interface JobLite { id: number; title?: string | null; company?: string | null; }

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'senior', 'junior', 'staff', 'lead', 'principal',
  'jobs', 'job', 'role', 'roles', 'level', 'iii', 'engineer', 'manager', 'specialist',
]);

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Find the jobs already in the database that the user's words most likely refer
 * to, so the coach can pull the real posting instead of asking for a URL.
 * Company name is the strong signal, title overlap is the weak one.
 */
export function pickMentionedJobs<T extends JobLite>(text: string, jobs: T[], max = 2): T[] {
  const hay = ` ${norm(text)} `;
  if (hay.trim().length < 2) return [];

  const scored: { job: T; score: number }[] = [];
  for (const job of jobs) {
    let score = 0;
    const company = norm(job.company);
    if (company.length >= 3 && hay.includes(` ${company} `)) score += 3;
    else if (company.length >= 4 && hay.includes(company)) score += 2;

    const words = norm(job.title).split(' ').filter(w => w.length >= 4 && !STOPWORDS.has(w));
    const hits = words.filter(w => hay.includes(` ${w} `)).length;
    if (hits >= 2) score += 2;
    else if (hits === 1) score += 1;

    if (score > 0) scored.push({ job, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map(s => s.job);
}
