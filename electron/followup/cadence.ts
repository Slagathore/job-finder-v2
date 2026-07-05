// Follow-up cadence (PLAN.md §15 polish). Pure — no electron/db imports.

export interface FollowupInput { appId: number; jobId: number; company: string; title: string; state: string; since: number | null; url?: string; }
export interface Followup extends FollowupInput { daysSince: number; due: boolean; action: string; }

const DAY = 24 * 60 * 60 * 1000;

// Days of silence after which a nudge is suggested, per state.
const THRESHOLD: Record<string, number> = { applied: 7, responded: 5, interview: 3 };
const ACTION: Record<string, string> = {
  applied: 'Send a brief follow-up note',
  responded: 'Nudge — ask about timeline / next steps',
  interview: 'Send a thank-you + ask about next steps',
};

/** Compute follow-up suggestions for open applications. Pure + testable. */
export function computeFollowups(rows: FollowupInput[], now: number): Followup[] {
  return rows
    .filter(r => THRESHOLD[r.state] != null)
    .map(r => {
      const since = r.since ?? now;
      const daysSince = Math.floor((now - since) / DAY);
      return { ...r, daysSince, due: daysSince >= THRESHOLD[r.state], action: ACTION[r.state] };
    })
    .filter(f => f.due)
    .sort((a, b) => b.daysSince - a.daysSince);
}
