/**
 * Hostile job aggregators (pure — no db, fs, or electron imports, so vitest
 * can load it).
 *
 * Sites like Indeed are JavaScript-rendered and actively hostile to
 * automated scraping, which is exactly why the browser extension exists: it
 * harvests them from a real logged-in browser tab instead of a scanner. If
 * one of these domains is tracked as a DOM board, a scan against it always
 * comes back with zero jobs, the auto-learning repair flags its adapter
 * "stale", and the Boards tab invites a re-learn that can never succeed:
 * there is no selector fix for a page that refuses to render outside a real
 * browser. These domains should never be treated as a scannable DOM board.
 */

export const HOSTILE_AGGREGATOR_DOMAINS = [
  'indeed.com',
  'linkedin.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'careerbuilder.com',
];

export const HOSTILE_AGGREGATOR_NOTE =
  'This site is harvested through the browser extension, not by scanning. It renders with ' +
  'JavaScript and blocks automated scraping, so there is no selector fix a re-learn could find here.';

function hostname(url: string): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    // Not a full URL (e.g. a bare "indeed.com" was passed) — strip scheme/path by hand.
    return raw.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  }
}

/** Is this URL (or bare hostname) one of the aggregators the extension harvests instead of scanning? */
export function isHostileAggregator(url: string): boolean {
  const host = hostname(url);
  if (!host) return false;
  return HOSTILE_AGGREGATOR_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
}
