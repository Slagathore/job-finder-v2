import { describe, it, expect } from 'vitest';
import { classifyLiveness } from '../electron/apply/liveness';
import { rankLivenessCandidates, RECHECK_COOLDOWN_DAYS, type LivenessRow } from '../electron/apply/liveness-priority';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 3);

describe('classifyLiveness', () => {
  it('treats empty html (fetch failure) as unreachable, never dead', () => {
    expect(classifyLiveness('')).toEqual({ live: false, reason: 'unreachable' });
  });
  it('flags a real closed/expired signal as not live', () => {
    expect(classifyLiveness('<p>This position has been filled.</p>')).toEqual({ live: false, reason: 'closed/expired' });
    expect(classifyLiveness('<p>This job is no longer accepting applications.</p>').live).toBe(false);
    expect(classifyLiveness('<p>404 Error - page not found</p>').live).toBe(false);
  });
  it('treats an ordinary posting page as live', () => {
    expect(classifyLiveness('<h1>Senior Engineer</h1><p>Apply now</p>')).toEqual({ live: true, reason: 'live' });
  });
});

function row(over: Partial<LivenessRow>): LivenessRow {
  return {
    id: 1, starred: 0, surfaced: 0, first_seen: NOW, expires_at: null,
    liveness_checked_at: null, liveness_status: null, has_application: 0,
    ...over,
  };
}

describe('rankLivenessCandidates', () => {
  it('never re-offers a job already confirmed dead', () => {
    const rows = [row({ id: 1, liveness_status: 'dead' }), row({ id: 2 })];
    expect(rankLivenessCandidates(rows, NOW).map(r => r.id)).toEqual([2]);
  });
  it('skips a job checked within the cooldown window', () => {
    const rows = [
      row({ id: 1, liveness_checked_at: NOW - (RECHECK_COOLDOWN_DAYS - 1) * DAY }),
      row({ id: 2, liveness_checked_at: NOW - (RECHECK_COOLDOWN_DAYS + 1) * DAY }),
      row({ id: 3, liveness_checked_at: null }),
    ];
    const ids = rankLivenessCandidates(rows, NOW).map(r => r.id);
    expect(ids).not.toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
  });
  it('prioritises starred and applied-to jobs over untouched old rows', () => {
    const rows = [
      row({ id: 1 }),                                  // plain, untouched
      row({ id: 2, starred: 1 }),
      row({ id: 3, has_application: 1 }),
    ];
    const ids = rankLivenessCandidates(rows, NOW).map(r => r.id);
    expect(ids[0]).toBe(2);   // starred wins
    expect(ids[1]).toBe(3);   // applied-to next
    expect(ids[2]).toBe(1);
  });
  it('prioritises a posting past its soft expiry over one not yet expired', () => {
    const rows = [
      row({ id: 1, expires_at: NOW + DAY }),   // not expired yet
      row({ id: 2, expires_at: NOW - DAY }),   // past soft expiry
    ];
    expect(rankLivenessCandidates(rows, NOW).map(r => r.id)).toEqual([2, 1]);
  });
  it('breaks ties by longest-since-checked, never-checked first', () => {
    const rows = [
      row({ id: 1, liveness_checked_at: NOW - 10 * DAY }),
      row({ id: 2, liveness_checked_at: null }),
      row({ id: 3, liveness_checked_at: NOW - 20 * DAY }),
    ];
    expect(rankLivenessCandidates(rows, NOW).map(r => r.id)).toEqual([2, 3, 1]);
  });
});
