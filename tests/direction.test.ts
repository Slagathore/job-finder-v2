import { describe, it, expect } from 'vitest';
import {
  INTAKE_QUESTIONS, describeIntake, intakeComplete, missingLabels, missingRequired,
  normalizeIntake, splitList,
} from '../electron/career/intake';
import {
  adjacencyNote, buildDirectionPrompt, collectCertSignals, directionSearchName,
  directionToSearchParams, markAdjacencies, parseDirectionReport, type Direction,
} from '../electron/career/direction-prompt';

const FULL = {
  pay_floor: '$65,000', pay_target: 95000, work_mode: ['remote', 'hybrid'],
  location: 'Dallas Fort Worth', relocate: 'for the right job', customer_facing: 'avoid it',
  work_style: 'small team', manage_people: 'no', industries_want: 'games, logistics',
  industries_avoid: 'insurance', schedule: 'no overnights', retraining: 'a few months',
};

describe('normalizeIntake', () => {
  it('coerces money strings and keeps only known options', () => {
    const a = normalizeIntake({ ...FULL, junk: 'ignored', work_mode: ['remote', 'moon base'] });
    expect(a.pay_floor).toBe(65000);
    expect(a.work_mode).toEqual(['remote']);
    expect((a as any).junk).toBeUndefined();
  });
  it('drops single choice answers that are not offered', () => {
    expect(normalizeIntake({ relocate: 'maybe someday' }).relocate).toBeUndefined();
    expect(normalizeIntake({ relocate: 'no' }).relocate).toBe('no');
  });
  it('drops unusable numbers rather than storing NaN', () => {
    expect(normalizeIntake({ pay_floor: 'lots' }).pay_floor).toBeUndefined();
    expect(normalizeIntake({ pay_floor: -5 }).pay_floor).toBeUndefined();
  });
  it('survives garbage input', () => {
    expect(normalizeIntake(null)).toEqual({});
    expect(normalizeIntake('nope')).toEqual({});
  });
});

describe('intake completeness', () => {
  it('names every unanswered required question', () => {
    const missing = missingRequired({});
    expect(missing).toEqual(INTAKE_QUESTIONS.filter(q => q.required).map(q => q.id));
    expect(missingLabels(missing).length).toBe(missing.length);
    expect(intakeComplete({})).toBe(false);
  });
  it('is complete once the required ones are answered', () => {
    expect(intakeComplete(normalizeIntake(FULL))).toBe(true);
  });
});

describe('describeIntake', () => {
  it('says which questions were skipped and formats money', () => {
    const text = describeIntake(normalizeIntake({ pay_floor: 65000 }));
    expect(text).toContain('$65,000');
    expect(text).toContain('not answered');
  });
});

describe('splitList', () => {
  it('splits on commas and semicolons', () => {
    expect(splitList('games, logistics; health')).toEqual(['games', 'logistics', 'health']);
    expect(splitList(undefined)).toEqual([]);
  });
});

describe('collectCertSignals', () => {
  it('finds credentials in the line items and ignores the rest', () => {
    const found = collectCertSignals([
      { kind: 'education', text: 'CompTIA A+ certification, 2019' },
      { kind: 'accomplishment', text: 'Rebuilt the warehouse pick path' },
      { kind: 'education', text: 'Licensed forklift operator' },
    ]);
    expect(found).toHaveLength(2);
  });
});

const REPORT = JSON.stringify({
  summary: 'You have shipped more than your resume shows.',
  directions: [
    {
      title: 'Solutions Engineer', kind: 'core', fit: 0.6, why: 'you demo well',
      evidence: ['Ran the customer demos at Acme'], gaps: ['no formal SaaS experience'],
      pay: '$90k to $130k', demand: 'steady', next_step: 'apply to three this week',
      titles: ['Solutions Engineer', 'Sales Engineer'], industries: ['SaaS'],
      role_fits: [{ role_family: 'Solutions Engineer', industry: 'SaaS', confidence: 0.6, rationale: 'demo work' }],
    },
    {
      title: 'Technical Writer', kind: 'core', fit: 0.9, why: 'your docs are the best artifact you have',
      evidence: ['Wrote the runbook the whole team used'], gaps: ['no published samples'],
      pay: '$70k to $110k', demand: 'thin but real', next_step: 'publish two samples',
      titles: ['Technical Writer'], industries: ['software'], role_fits: [],
    },
  ],
  honest_note: 'Warehouse management is a weak fit and you should skip it.',
});

describe('parseDirectionReport', () => {
  it('ranks by fit and keeps the evidence', () => {
    const r = parseDirectionReport(REPORT);
    expect(r.directions.map(d => d.title)).toEqual(['Technical Writer', 'Solutions Engineer']);
    expect(r.directions[0].evidence[0]).toContain('runbook');
    expect(r.honest_note).toContain('weak fit');
  });
  it('clamps a nonsense fit score', () => {
    const r = parseDirectionReport('{"directions":[{"title":"X","fit":42}]}');
    expect(r.directions[0].fit).toBe(1);
  });
  it('throws instead of returning an empty report', () => {
    expect(() => parseDirectionReport('I am not able to answer that')).toThrow(/no usable directions/i);
    expect(() => parseDirectionReport('{"directions":[]}')).toThrow(/no usable directions/i);
  });
});

const dir = (over: Partial<Direction>): Direction => ({
  title: 'Technical Writer', kind: 'core', fit: 0.8, why: '', evidence: [], gaps: [],
  pay: '', demand: '', next_step: '', titles: [], industries: [], role_fits: [], ...over,
});

describe('markAdjacencies', () => {
  it('calls a direction an adjacency only when it is not already a known role fit', () => {
    const out = markAdjacencies(
      [dir({ title: 'Technical Writer' }), dir({ title: 'Field Service Technician' })],
      ['technical writer', 'Support Engineer'],
    );
    expect(out[0].kind).toBe('core');
    expect(out[1].kind).toBe('adjacency');
  });
  it('does not relabel a known fit just because the model called it new', () => {
    const out = markAdjacencies([dir({ title: 'Support Engineer', kind: 'adjacency' })], ['Support Engineer']);
    expect(out[0].kind).toBe('core');
  });
});

describe('adjacencyNote', () => {
  it('is empty when there is a real adjacency and honest when there is not', () => {
    expect(adjacencyNote([dir({ kind: 'adjacency' })])).toBe('');
    expect(adjacencyNote([dir({ kind: 'core' })])).toMatch(/overlaps a role fit already on file/);
  });
});

describe('directionToSearchParams', () => {
  it('carries the intake constraints into the saved search', () => {
    const p = directionToSearchParams(
      dir({ title: 'Technical Writer', titles: ['Technical Writer', 'Documentation Specialist'] }),
      normalizeIntake(FULL),
    );
    expect(p.roleFamily).toBe('Technical Writer');
    expect(p.tags).toBe('Technical Writer, Documentation Specialist');
    expect(p.payMin).toBe(65000);
    expect(p.workModes).toEqual(['remote', 'hybrid']);
    expect(p.locText).toBe('Dallas Fort Worth');
    expect(p.excludeKeyword).toBe('insurance');
  });
  it('falls back to the direction title when the model gave no titles', () => {
    expect(directionToSearchParams(dir({ titles: [] }), {}).tags).toBe('Technical Writer');
  });
});

describe('directionSearchName', () => {
  it('prefixes and truncates', () => {
    expect(directionSearchName(dir({}))).toBe('Direction: Technical Writer');
    expect(directionSearchName(dir({ title: 'x'.repeat(120) })).length).toBe(60);
  });
});

describe('buildDirectionPrompt', () => {
  it('puts the profile, the fits, the credentials and the intake in front of the model', () => {
    const msgs = buildDirectionPrompt({
      profile: { narrative: 'warehouse lead turned tinkerer', skills: ['sql'], domains: ['logistics'], seniority: 'mid', total_yoe: 8 },
      items: [
        { kind: 'accomplishment', text: 'Cut pick times 30 percent', employer: 'Acme' },
        { kind: 'education', text: 'CompTIA A+ certification' },
        { kind: 'project', text: 'Built a route planner', source_ref: 'github:Slagathore/routes' },
      ],
      roleFits: [{ role_family: 'Operations Analyst', industry: 'logistics', confidence: 0.7 }],
      intake: normalizeIntake(FULL),
    });
    const user = msgs[1].content;
    expect(user).toContain('warehouse lead turned tinkerer');
    expect(user).toContain('Operations Analyst');
    expect(user).toContain('CompTIA A+');
    expect(user).toContain('Dallas Fort Worth');
    expect(user).toContain('github:Slagathore/routes');
  });
  it('says plainly when there are no credentials on file', () => {
    const msgs = buildDirectionPrompt({ profile: null, items: [{ kind: 'skill', text: 'excel' }], roleFits: [], intake: {} });
    expect(msgs[1].content).toContain('none found');
  });
});
