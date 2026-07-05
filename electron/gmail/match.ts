import { normalizeCompany } from '../lib/company';
import type { Email } from './client';

export interface AppRow { appId: number; jobId: number; company: string; }

/**
 * Match an email to an open application by company name appearing in the
 * sender/subject/body (or an LLM-extracted company hint). Pure — testable.
 */
export function matchEmailToApplication(email: Email, hintCompany: string | null, apps: AppRow[]): AppRow | null {
  const hay = `${email.from} ${email.subject} ${email.body}`.toLowerCase();
  const hintNorm = hintCompany ? normalizeCompany(hintCompany) : '';
  let best: AppRow | null = null;
  for (const a of apps) {
    const norm = normalizeCompany(a.company);
    if (!norm) continue;
    if (hay.includes(norm) || (hintNorm && (hintNorm.includes(norm) || norm.includes(hintNorm)))) {
      // Prefer the longest company match (more specific).
      if (!best || norm.length > normalizeCompany(best.company).length) best = a;
    }
  }
  return best;
}
