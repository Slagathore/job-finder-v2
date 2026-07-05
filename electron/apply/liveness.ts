import { fetchHtml } from '../boards/fetch-html';

export interface Liveness { live: boolean; reason: string; }

const CLOSED = /no longer (accepting|available|open)|position (has been )?(filled|closed)|this job (is )?no longer|posting (has )?(closed|expired)|job not found|page not found|404 error|requisition .* closed/i;

/** Classify liveness from fetched content. Pure — testable. */
export function classifyLiveness(html: string): Liveness {
  if (!html) return { live: false, reason: 'unreachable' };
  if (CLOSED.test(html)) return { live: false, reason: 'closed/expired' };
  return { live: true, reason: 'live' };
}

/** Re-check a posting is still open right before applying (§6.1). */
export async function checkLiveness(url: string): Promise<Liveness> {
  const html = await fetchHtml(url);
  return classifyLiveness(html);
}
