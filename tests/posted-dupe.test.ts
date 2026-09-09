import { describe, it, expect } from 'vitest';
import { parsePostedAt, deriveExpiresAt, isExpired, DEFAULT_SHELF_LIFE_DAYS } from '../electron/ingest/posted';
import { textSimilarity, findDuplicate, mergeItems } from '../electron/experience/dupe-rule';
import { backfillRange } from '../electron/intel/parse';
import { matchesExcludeKeyword } from '../electron/discovery/rank';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 3);

describe('parsePostedAt', () => {
  it('reads relative posting text', () => {
    expect(parsePostedAt('Just posted', NOW)).toBe(NOW);
    expect(parsePostedAt('Posted 3 days ago', NOW)).toBe(NOW - 3 * DAY);
    expect(parsePostedAt('Active 30+ days ago', NOW)).toBe(NOW - 30 * DAY);
    expect(parsePostedAt('2 weeks ago', NOW)).toBe(NOW - 14 * DAY);
    expect(parsePostedAt('yesterday', NOW)).toBe(NOW - DAY);
    expect(parsePostedAt('a month ago', NOW)).toBe(NOW - 30 * DAY);
  });
  it('returns null for junk and never invents a future date', () => {
    expect(parsePostedAt('', NOW)).toBeNull();
    expect(parsePostedAt(null, NOW)).toBeNull();
    expect(parsePostedAt('apply now', NOW)).toBeNull();
  });
});

describe('deriveExpiresAt', () => {
  it('counts a full shelf life from the posting date', () => {
    const posted = NOW - 5 * DAY;
    expect(deriveExpiresAt(posted, NOW)).toBe(posted + DEFAULT_SHELF_LIFE_DAYS * DAY);
  });
  it('falls back to first_seen when the posting date is unknown', () => {
    expect(deriveExpiresAt(null, NOW)).toBe(NOW + DEFAULT_SHELF_LIFE_DAYS * DAY);
  });
  it('gives an already-old posting only a short remaining life', () => {
    expect(deriveExpiresAt(NOW - 60 * DAY, NOW)).toBe(NOW + 14 * DAY);
  });
  it('isExpired only fires on a real past timestamp', () => {
    expect(isExpired(NOW - DAY, NOW)).toBe(true);
    expect(isExpired(NOW + DAY, NOW)).toBe(false);
    expect(isExpired(null, NOW)).toBe(false);
  });
});

describe('experience line-item dedup', () => {
  const a = { kind: 'accomplishment', text: 'Built an automated reporting pipeline that cut monthly close time by 40%', employer: 'Acme' };
  const restated = { kind: 'accomplishment', text: 'Built automated reporting pipeline cutting monthly close time 40% at Acme', employer: 'Acme' };
  const different = { kind: 'accomplishment', text: 'Ran the QA lab and trained four junior chemists on GC-MS methods', employer: 'Acme' };

  it('scores restatements high and unrelated bullets low', () => {
    expect(textSimilarity(a.text, restated.text)).toBeGreaterThan(0.62);
    expect(textSimilarity(a.text, different.text)).toBeLessThan(0.2);
  });
  it('finds a restatement as a duplicate', () => {
    expect(findDuplicate(restated, [{ ...a, id: 1 }])?.id).toBe(1);
    expect(findDuplicate(different, [{ ...a, id: 1 }])).toBeNull();
  });
  it('never merges across different employers', () => {
    expect(findDuplicate({ ...restated, employer: 'Globex' }, [{ ...a, id: 1 }])).toBeNull();
  });
  it('never merges across kinds', () => {
    expect(findDuplicate({ ...restated, kind: 'skill' }, [{ ...a, id: 1 }])).toBeNull();
  });
  it('merge keeps the longer text and fills blank fields', () => {
    const existing = { id: 1, kind: 'accomplishment', text: 'Short version', employer: null, role: null, start_date: null, end_date: null, metrics: null };
    const merged = mergeItems(existing, { kind: 'accomplishment', text: 'A considerably longer and more specific version', employer: 'Acme', role: 'Analyst', start_date: '2020', end_date: '2023', metrics: '40%' });
    expect(merged.text).toBe('A considerably longer and more specific version');
    expect(merged.employer).toBe('Acme');
    expect(merged.role).toBe('Analyst');
    expect(merged.id).toBe(1);
  });
});

describe('salary backfillRange', () => {
  it('leaves a complete range alone', () => {
    const est = { min: 90_000, max: 120_000, confidence: 'high', note: '' };
    backfillRange(est);
    expect(est).toMatchObject({ min: 90_000, max: 120_000, confidence: 'high' });
  });
  it('widens from a single bound', () => {
    const est: any = { min: 100_000, max: null, confidence: 'medium', note: '' };
    backfillRange(est);
    expect(est.max).toBe(140_000);
    expect(est.confidence).toBe('low');
  });
  it('uses the BLS median when the model gave nothing', () => {
    const est: any = { min: null, max: null, confidence: 'high', note: '', blsMedian: 100_000 };
    backfillRange(est);
    expect(est.min).toBe(70_000);
    expect(est.max).toBe(130_000);
  });
  it('always yields some range, never nulls', () => {
    const est: any = { min: null, max: null, confidence: 'high', note: '' };
    backfillRange(est);
    expect(est.min).toBeGreaterThan(0);
    expect(est.max).toBeGreaterThan(est.min);
    expect(est.confidence).toBe('low');
  });
});

describe('negative keyword filter', () => {
  const job = { title: 'Senior Sales Engineer', company: 'Acme', description: 'Commission-based role with travel' };
  it('passes when empty', () => {
    expect(matchesExcludeKeyword(job, '')).toBe(true);
  });
  it('excludes on any comma-separated term', () => {
    expect(matchesExcludeKeyword(job, 'commission')).toBe(false);
    expect(matchesExcludeKeyword(job, 'nursing, commission')).toBe(false);
    expect(matchesExcludeKeyword(job, 'nursing, welding')).toBe(true);
  });
  it('matches multi-word terms as phrases', () => {
    expect(matchesExcludeKeyword(job, 'commission-based')).toBe(false);
    expect(matchesExcludeKeyword(job, 'based commission')).toBe(true);
  });
});
