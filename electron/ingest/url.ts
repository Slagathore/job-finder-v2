// Pure URL helpers — no electron/db imports, so they stay unit-testable.

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'utm_term', 'refId', 'trk', 'trackingId', 'from', 'hl', 'gclid', 'fbclid'];

/** Strip tracking params + hash for stable dedup; tolerant of junk input. */
export function normalizeJobUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : 'https:' + url);
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}
