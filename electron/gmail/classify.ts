import { generate, type ChatMessage } from '../llm/provider';
import { parseJsonLoose } from '../lib/json';
import type { Settings } from '../ipc/settings';
import type { Email } from './client';

export type EmailClass = 'ack' | 'rejection' | 'interview' | 'offer' | 'recruiter' | 'other';
const CLASSES: EmailClass[] = ['ack', 'rejection', 'interview', 'offer', 'recruiter', 'other'];

const SYSTEM = `Classify a job-search email into exactly one category:
- ack: application received / under review acknowledgement
- rejection: not moving forward / position filled
- interview: invitation to interview / schedule a call / assessment
- offer: job offer extended
- recruiter: recruiter/sourcer outreach about a role
- other: anything else (newsletters, noise)
Respond with ONLY: { "classification": "<one>", "company": "<company name if identifiable, else null>" }`;

export function buildClassifyPrompt(email: Email): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body.slice(0, 3000)}` },
  ];
}

export function parseClassification(text: string): { classification: EmailClass; company: string | null } {
  const p = parseJsonLoose<any>(text) ?? {};
  const c = typeof p.classification === 'string' ? p.classification.toLowerCase().trim() : 'other';
  return {
    classification: (CLASSES.includes(c as EmailClass) ? c : 'other') as EmailClass,
    company: typeof p.company === 'string' && p.company.trim() ? p.company.trim() : null,
  };
}

/** Pipeline state an email classification implies (null = no change). */
export function stateForClassification(c: EmailClass): string | null {
  switch (c) {
    case 'rejection': return 'rejected';
    case 'interview': return 'interview';
    case 'offer': return 'offer';
    case 'ack': return 'responded';
    case 'recruiter': return 'responded';
    default: return null;
  }
}

export async function classifyEmail(s: Settings, email: Email) {
  const r = await generate(s, buildClassifyPrompt(email), { temperature: 0.1, maxTokens: 200 });
  return parseClassification(r.text);
}
