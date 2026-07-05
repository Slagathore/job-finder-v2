// Retention rule (pure — no db imports). A job is prunable ONLY if it is an
// untouched, old "discovered" job. Anything the user has interacted with —
// starred, graded (fit_score), salary-checked, surfaced by discovery, or with
// ANY application row — is NEVER auto-pruned (manual remove only). PLAN §4.

export interface PrunableJob {
  status: string; starred: number; surfaced: number;
  fit_score: any; salary_estimate: any; first_seen: number;
}

export function isPrunable(job: PrunableJob, cutoffMs: number, hasApplication: boolean): boolean {
  if (hasApplication) return false;          // initiated on → keep
  if (job.starred) return false;             // checked → keep
  if (job.surfaced) return false;            // discovery-surfaced → keep
  if (job.fit_score != null) return false;   // graded → keep
  if (job.salary_estimate != null) return false; // salary-checked → keep
  if (job.status !== 'discovered') return false;  // moved past discovered → keep
  return job.first_seen < cutoffMs;          // only old, untouched discovered jobs
}

/** SQL form of `isPrunable` — kept identical to the predicate above. */
export const PRUNE_WHERE =
  `status = 'discovered' AND starred = 0 AND surfaced = 0
   AND fit_score IS NULL AND salary_estimate IS NULL
   AND first_seen < @cutoff
   AND id NOT IN (SELECT job_id FROM applications)`;
