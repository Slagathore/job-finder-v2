import { describe, it, expect } from 'vitest';
import { cosine, toBlob, fromBlob, topKMeanSim } from '../electron/discovery/vector';
import {
  parsePay, payNorm, wfhScore, combineScore, boostFactor, isGrade, matchesWorkModes, matchesKeyword,
  tokenize, bm25Rank, rrfFuse, fusedScore, RRF_K,
} from '../electron/discovery/rank';
import { parseGrade, buildCandidateContext, buildGradePrompt } from '../electron/discovery/grade';

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
  it('boostFactor is the booster half of combineScore', () => {
    const w = { payWeight: 1, wfhWeight: 1 };
    expect(boostFactor({ pay: 250000, workMode: 'remote' }, w)).toBeCloseTo(0.3, 6);
    expect(boostFactor({ pay: null, workMode: 'onsite' }, w)).toBe(0);
  });
  it('isGrade accepts only A-F, case and space tolerant', () => {
    expect(isGrade('A')).toBe(true);
    expect(isGrade(' c ')).toBe(true);
    expect(isGrade('Z')).toBe(false);
    expect(isGrade(null)).toBe(false);
    expect(isGrade('')).toBe(false);
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

describe('tokenize', () => {
  it('lowercases, keeps tech tokens, drops stopwords and single chars', () => {
    expect(tokenize('Senior Node.js and C++ Engineer')).toEqual(['senior', 'node.js', 'c++', 'engineer']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
  it('strips trailing punctuation from a token', () => {
    expect(tokenize('kubernetes, terraform.')).toEqual(['kubernetes', 'terraform']);
  });
});

describe('bm25Rank', () => {
  const docs = [
    { id: 1, text: 'Senior Kubernetes platform engineer running terraform' },
    { id: 2, text: 'Pastry chef, bakery, early mornings' },
    { id: 3, text: 'Kubernetes administrator' },
  ];

  it('ranks the doc with more query-term evidence first', () => {
    const hits = bm25Rank(docs, 'kubernetes terraform');
    expect(hits[0].id).toBe(1);
    expect(hits.map(h => h.id)).not.toContain(2);   // no query term at all
  });

  it('rewards the rarer term: a two-term match beats a common-term-only match', () => {
    const hits = bm25Rank(docs, 'kubernetes terraform');
    const s1 = hits.find(h => h.id === 1)!.score;
    const s3 = hits.find(h => h.id === 3)!.score;
    expect(s1).toBeGreaterThan(s3);
  });

  it('an empty query or empty corpus scores nothing', () => {
    expect(bm25Rank(docs, '')).toEqual([]);
    expect(bm25Rank(docs, '   ')).toEqual([]);
    expect(bm25Rank(docs, 'the and for')).toEqual([]);   // stopwords only
    expect(bm25Rank([], 'kubernetes')).toEqual([]);
  });

  it('a term present in every document does not go negative', () => {
    const all = [{ id: 1, text: 'kubernetes' }, { id: 2, text: 'kubernetes' }];
    for (const h of bm25Rank(all, 'kubernetes')) expect(h.score).toBeGreaterThanOrEqual(0);
  });

  it('length normalisation favours the tighter document', () => {
    const pair = [
      { id: 1, text: 'kubernetes engineer' },
      { id: 2, text: 'kubernetes engineer ' + 'filler content here '.repeat(40) },
    ];
    const hits = bm25Rank(pair, 'kubernetes');
    expect(hits[0].id).toBe(1);
  });
});

describe('rrfFuse', () => {
  it('scores by reciprocal rank across both systems', () => {
    const f = rrfFuse([[7, 8], [8, 7]]);
    // Both appear once at rank 1 and once at rank 2, so they tie.
    expect(f.get(7)).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2), 12);
    expect(f.get(7)).toBeCloseTo(f.get(8)!, 12);
  });

  it('agreement between the two systems outranks a single-system hit', () => {
    const f = rrfFuse([[1, 2], [1, 3]]);
    expect(f.get(1)!).toBeGreaterThan(f.get(2)!);
    expect(f.get(1)!).toBeGreaterThan(f.get(3)!);
  });

  it('one empty system degrades to the other, and two empties fuse to nothing', () => {
    const only = rrfFuse([[], [5, 6]]);
    expect([...only.keys()]).toEqual([5, 6]);
    expect(only.get(5)!).toBeGreaterThan(only.get(6)!);
    expect(rrfFuse([[], []]).size).toBe(0);
    expect(rrfFuse([]).size).toBe(0);
  });

  it('fusedScore keeps the booster soft: it cannot outweigh a top rank', () => {
    const ranked = fusedScore(1 / (RRF_K + 1), 0);        // rank 1, no boost
    const unranked = fusedScore(0, 0.3);                  // retrieved by neither, max boost
    expect(ranked).toBeGreaterThan(unranked);
    // With nothing retrieved at all, the boosters are the only ordering signal.
    expect(fusedScore(0, 0.3)).toBeGreaterThan(fusedScore(0, 0));
  });
});

describe('grade rubric context', () => {
  it('states unset constraints plainly instead of leaving them blank', () => {
    const c = buildCandidateContext({});
    expect(c).toContain('Pay floor: not set');
    expect(c).toContain('Pay target: not set');
    expect(c).toContain('Work mode preference: no stated preference');
  });
  it('carries the profile, pay floor/target, mode and location into the prompt', () => {
    const msgs = buildGradePrompt(
      { title: 'Platform Engineer', company: 'Acme', description: 'k8s', salary_listed: '$150k', work_mode: 'remote' },
      [{ id: 3, kind: 'role', text: 'ran a k8s fleet' }],
      {
        profile: { skills: ['kubernetes'], domains: ['infra'], seniority: 'senior', total_yoe: 8, narrative: 'infra lead' },
        payFloor: 120000, payTarget: 180000, workModePreference: 'remote',
        locationPreference: 'Dallas, TX', radiusMi: 50,
      }
    );
    const user = msgs[1].content;
    expect(user).toContain('Pay floor: $120k/yr');
    expect(user).toContain('Pay target: $180k/yr');
    expect(user).toContain('Work mode preference: remote');
    expect(user).toContain('Dallas, TX');
    expect(user).toContain('kubernetes');
    expect(user).toContain('[3] (role) ran a k8s fleet');
    expect(msgs[0].content).toContain('GRADE MEANINGS');
  });
});
