import { describe, it, expect } from 'vitest';
import { cosine, toBlob, fromBlob, topKMeanSim } from '../electron/discovery/vector';
import {
  parsePay, payNorm, wfhScore, combineScore, simToGrade, matchesWorkModes, matchesKeyword,
} from '../electron/discovery/rank';
import { parseGrade } from '../electron/discovery/grade';

describe('vector', () => {
  it('cosine: identical = 1, orthogonal = 0', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('blob round-trips float32', () => {
    const v = [0.5, -0.25, 1.5, 0.0];
    const back = Array.from(fromBlob(toBlob(v)));
    expect(back).toEqual(v);
  });
  it('topKMeanSim averages the best k', () => {
    const job = [1, 0];
    const items = [[1, 0], [0, 1], [0.7, 0.7]]; // sims ~ 1, 0, 0.707
    expect(topKMeanSim(job, items, 2)).toBeCloseTo((1 + 0.7071) / 2, 3);
    expect(topKMeanSim(job, [], 3)).toBe(0);
  });
});

describe('parsePay', () => {
  it('parses k-notation, ranges, plain, hourly', () => {
    expect(parsePay('$120k')).toBe(120000);
    expect(parsePay('$120,000 - $150,000')).toBe(135000);
    expect(parsePay('150000')).toBe(150000);
    expect(parsePay('$60/hr')).toBe(124800);
    expect(parsePay('competitive')).toBeNull();
    expect(parsePay(null)).toBeNull();
  });
});

describe('rank helpers', () => {
  it('payNorm caps 0..1, null = 0', () => {
    expect(payNorm(null)).toBe(0);
    expect(payNorm(125000, 250000)).toBeCloseTo(0.5);
    expect(payNorm(500000, 250000)).toBe(1);
  });
  it('wfhScore', () => {
    expect(wfhScore('remote')).toBe(1);
    expect(wfhScore('hybrid')).toBe(0.5);
    expect(wfhScore('onsite')).toBe(0);
    expect(wfhScore(null)).toBe(0);
  });
  it('combineScore keeps similarity dominant, boosters additive', () => {
    const w = { payWeight: 1, wfhWeight: 1 };
    const remoteHigh = combineScore(0.5, { pay: 250000, workMode: 'remote' }, w);
    const onsiteUnknown = combineScore(0.5, { pay: null, workMode: 'onsite' }, w);
    expect(onsiteUnknown).toBeCloseTo(0.5, 6);          // no boost
    expect(remoteHigh).toBeCloseTo(0.5 + 0.15 + 0.15, 6); // both boosts
    expect(remoteHigh).toBeGreaterThan(onsiteUnknown);
  });
  it('simToGrade is monotonic A→F', () => {
    expect(simToGrade(0.7)).toBe('A');
    expect(simToGrade(0.53)).toBe('B');
    expect(simToGrade(0.46)).toBe('C');
    expect(simToGrade(0.39)).toBe('D');
    expect(simToGrade(0.1)).toBe('F');
  });
  it('matchesWorkModes / matchesKeyword', () => {
    expect(matchesWorkModes('remote', [])).toBe(true);
    expect(matchesWorkModes('remote', ['remote', 'hybrid'])).toBe(true);
    expect(matchesWorkModes('onsite', ['remote'])).toBe(false);
    expect(matchesKeyword({ title: 'Senior AI Engineer' }, 'ai engineer')).toBe(true);
    expect(matchesKeyword({ title: 'Cook' }, 'ai')).toBe(false);
    expect(matchesKeyword({ title: 'x' }, '')).toBe(true);
  });
});

describe('parseGrade', () => {
  it('parses a grade payload', () => {
    const r = parseGrade('{"grade":"B","rationale":"good overlap","supporting_item_ids":[1,2]}');
    expect(r).toEqual({ grade: 'B', rationale: 'good overlap', supporting_item_ids: [1, 2] });
  });
  it('throws on garbled output instead of silently grading F', () => {
    expect(() => parseGrade('{"grade":"Z"}')).toThrow(/usable grade/);
    expect(() => parseGrade('sorry, I cannot')).toThrow(/usable grade/);
  });
});
