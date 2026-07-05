export type ApplyRoute = 'easyapply' | 'ats' | 'external';

/** Decide how an application would be submitted, from the posting URL (§6.1). */
export function detectRoute(url: string): ApplyRoute {
  const u = (url || '').toLowerCase();
  if (u.includes('linkedin.com')) return 'easyapply';
  if (/greenhouse\.io|ashbyhq\.com|jobs\.lever\.co|myworkdayjobs\.com|workable\.com/.test(u)) return 'ats';
  return 'external';
}
