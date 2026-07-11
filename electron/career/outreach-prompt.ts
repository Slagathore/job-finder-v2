import type { ChatMessage } from '../llm/provider';
import { parseJsonLoose } from '../lib/json';

/**
 * LinkedIn outreach message generation — the career-ops "contacto" power move
 * (modes/contacto.md). Pure prompt builder + parser; the 3-sentence framework
 * shifts EMPHASIS by contact type, never structure.
 */

export type ContactKind = 'recruiter' | 'hiring-manager' | 'peer' | 'interviewer' | 'other';

const FRAMEWORKS: Record<string, string> = {
  'recruiter': `Sentence 1 (fit): direct match criteria — role, relevant experience, availability or location.
Sentence 2 (proof): a datum that answers their screening questions before they ask (e.g. "5 years building ML pipelines, in Dallas, available immediately").
Sentence 3 (CTA): "Happy to share my CV if this aligns with what you're looking for."`,
  'hiring-manager': `Sentence 1 (hook): a specific challenge their team faces (from the JD, company blog, or news).
Sentence 2 (proof): the candidate's most quantifiable accomplishment showing they've solved similar problems.
Sentence 3 (CTA): "Would love to hear how your team is approaching <that specific challenge>."`,
  'peer': `Sentence 1 (interest): a genuine reference to their work — blog post, talk, open-source project.
Sentence 2 (connection): something the candidate is doing in the same space (NOT a job pitch).
Sentence 3 (CTA): "I've been working on similar problems, would love your take on <topic>."
Note: NEVER ask for a job — a referral happens naturally if the conversation flows.`,
  'interviewer': `Sentence 1 (research): reference something specific about their work or background.
Sentence 2 (context): a light connection to the candidate's experience on that topic.
Sentence 3 (CTA): "Looking forward to our conversation."
Note: light tone, not desperate — the goal is that they know you prepared.`,
  'other': `Sentence 1: why this specific person (their work, their role).
Sentence 2: the candidate's most relevant credential for that context.
Sentence 3: a low-pressure, specific call to action.`,
};

const RULES = `Hard rules:
- Maximum 300 characters (LinkedIn connection-request limit)
- No corporate-speak; never "I'm passionate about..."
- Write something that makes them WANT to reply
- NEVER include a phone number
- Concrete beats flattering`;

export function buildOutreachPrompt(
  contact: { name?: string | null; title?: string | null; kind: string; company: string },
  candidate: { narrative?: string | null; skills?: string[]; topAccomplishments?: string[] },
  job?: { title: string; description?: string | null } | null
): ChatMessage[] {
  const kind = (contact.kind in FRAMEWORKS ? contact.kind : 'other') as ContactKind;
  const system = `Write a LinkedIn connection-request message from a job candidate to a ${kind} at a company.
Use this 3-sentence framework:
${FRAMEWORKS[kind]}
${RULES}
Respond with ONLY this JSON: { "message": "<the message, max 300 chars>", "alternate": "<a second variant with a different angle>" }`;

  const acc = (candidate.topAccomplishments ?? []).slice(0, 6).map(a => `- ${a}`).join('\n');
  const user = [
    `CONTACT: ${contact.name || 'unknown name'}${contact.title ? `, ${contact.title}` : ''} @ ${contact.company}`,
    job ? `TARGET ROLE: ${job.title}\n${(job.description ?? '').slice(0, 1500)}` : 'TARGET ROLE: (no specific posting — general interest in the company)',
    `CANDIDATE: ${candidate.narrative ?? 'n/a'}`,
    `Skills: ${(candidate.skills ?? []).slice(0, 15).join(', ') || 'n/a'}`,
    acc ? `Top accomplishments:\n${acc}` : '',
  ].filter(Boolean).join('\n\n');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function parseOutreach(text: string): { message: string; alternate: string } {
  const p = parseJsonLoose<any>(text) ?? {};
  const clamp = (s: any) => String(s ?? '').trim().slice(0, 300);
  return { message: clamp(p.message), alternate: clamp(p.alternate) };
}

/** "jane-doe-1a2b3c" → "Jane Doe" (career-ops formatName, slug fallback). */
export function nameFromSlugOrText(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // A LinkedIn slug: lowercase words joined by dashes, maybe a trailing hash.
  if (/^[a-z0-9-]+$/.test(s)) {
    return s.split('-')
      .filter(w => w && !/^\d+$/.test(w) && !/^[0-9a-f]{6,}$/.test(w))
      .map(w => w[0].toUpperCase() + w.slice(1))
      .join(' ');
  }
  // Search-result heading: "Jane Doe - Senior Recruiter - Acme | LinkedIn"
  return s.split(/[-–|]/)[0].trim().slice(0, 80);
}
