import { describe, it, expect } from 'vitest';
import { rankCandidates, type ScanJob } from '../electron/discovery/scan-core';
import { isPrunable, type PrunableJob } from '../electron/maintenance/prune-rule';

const job = (o: Partial<ScanJob>): ScanJob => ({
  id: 1, company: 'A', title: 'AI Engineer', url: 'u', description: '',
  work_mode: 'remote', salary_listed: null, geo_lat: null, geo_lng: null,
  fit_score: null, starred: 0, surfaced: 0, first_seen: 1, status: 'discovered', vec: null, ...o,
});
const W = { payWeight: 1, wfhWeight: 1 };

describe('rankCandidates', () => {
  it('orders by similarity to the query vector + grades', () => {
    const r = rankCandidates({
      jobs: [job({ id: 1, vec: [1, 0] }), job({ id: 2, title: 'Cook', vec: [0, 1] })],
      itemVecs: [], queryVec: [1, 0], weights: W, limit: 10,
    });
    expect(r.results.map(x => x.id)).toEqual([1, 2]);
    expect(r.results[0].sim).toBeCloseTo(1, 6);
    expect(r.results[0].fit_grade).toBe('A');
    expect(r.results[0].vec).toBeUndefined();   // vector stripped from output
  });

  it('applies work-mode, keyword and pay filters', () => {
    const jobs = [job({ id: 1, work_mode: 'remote' }), job({ id: 2, title: 'Cook', work_mode: 'onsite' })];
    expect(rankCandidates({ jobs, itemVecs: [], queryVec: null, weights: W, workModes: ['remote'] }).results.map(x => x.id)).toEqual([1]);
    expect(rankCandidates({ jobs, itemVecs: [], queryVec: null, weights: W, keyword: 'cook' }).results.map(x => x.id)).toEqual([2]);
    const paid = [job({ id: 1, salary_listed: '$60,000' }), job({ id: 2, salary_listed: '$200,000' })];
    expect(rankCandidates({ jobs: paid, itemVecs: [], queryVec: null, weights: W, payMin: 100000 }).results.map(x => x.id)).toEqual([2]);
  });

  it('falls back to the LLM salary_estimate for the pay-min filter', () => {
    const jobs = [
      job({ id: 1, salary_estimate: JSON.stringify({ min: 120000, max: 160000 }) }),
      job({ id: 2, salary_estimate: JSON.stringify({ min: 60000, max: 80000 }) }),
    ];
    expect(rankCandidates({ jobs, itemVecs: [], queryVec: null, weights: W, payMin: 100000 }).results.map(x => x.id)).toEqual([1]);
  });

  it('drops known-location jobs beyond the radius (remote always kept)', () => {
    const dallas = { lat: 32.7767, lng: -96.797 };
    const jobs = [
      job({ id: 1, work_mode: 'remote' }),                              // kept
      job({ id: 2, work_mode: 'onsite', geo_lat: 32.75, geo_lng: -97.33 }),  // ~30mi → kept @50
      job({ id: 3, work_mode: 'onsite', geo_lat: 40.71, geo_lng: -74.0 }),   // NYC → dropped @50
    ];
    const r = rankCandidates({ jobs, itemVecs: [], queryVec: null, weights: W, location: dallas, radiusMi: 50 });
    expect(r.results.map(x => x.id).sort()).toEqual([1, 2]);
  });
});

describe('isPrunable (retention safety)', () => {
  const base: PrunableJob = { status: 'discovered', starred: 0, surfaced: 0, fit_score: null, salary_estimate: null, first_seen: 0 };
  it('prunes only old, untouched discovered jobs', () => {
    expect(isPrunable(base, 1000, false)).toBe(true);
    expect(isPrunable({ ...base, first_seen: 2000 }, 1000, false)).toBe(false);  // too new
  });
  it('never prunes anything interacted with', () => {
    expect(isPrunable(base, 1000, true)).toBe(false);                  // has application
    expect(isPrunable({ ...base, starred: 1 }, 1000, false)).toBe(false);
    expect(isPrunable({ ...base, surfaced: 1 }, 1000, false)).toBe(false);
    expect(isPrunable({ ...base, fit_score: 'A' }, 1000, false)).toBe(false);
    expect(isPrunable({ ...base, salary_estimate: '{}' }, 1000, false)).toBe(false);
    expect(isPrunable({ ...base, status: 'applied' }, 1000, false)).toBe(false);
  });
});
