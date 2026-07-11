import { describe, it, expect } from 'vitest';
import { computeInsights, type OutcomeRow } from '../electron/career/analytics';
import { parseProjectEval, parseTrainingEval, buildDeepResearchPrompt } from '../electron/career/modes';
import { buildOutreachPrompt, parseOutreach, nameFromSlugOrText } from '../electron/career/outreach-prompt';

const row = (status: string, over: Partial<OutcomeRow> = {}): OutcomeRow =>
  ({ status, fit_score: 'B', work_mode: 'remote', source: 'indeed', first_seen: 1, ...over });

describe('computeInsights', () => {
  it('counts outcomes and computes response rates per bucket', () => {
    const rows = [
      row('applied'), row('responded'), row('interview'), row('offer'), row('rejected'),
    ];
    const r = computeInsights(rows);
    expect(r.applied).toBe(5);
    expect(r.responded).toBe(3);       // responded + interview + offer
    expect(r.interviews).toBe(2);      // interview + offer
    expect(r.offers).toBe(1);
    expect(r.rejected).toBe(1);
    expect(r.pending).toBe(1);
    const remote = r.byWorkMode.find(b => b.label === 'remote')!;
    expect(remote.applied).toBe(5);
    expect(remote.rate).toBeCloseTo(3 / 5);
  });

  it('surfaces a contrast note when one segment clearly outperforms another', () => {
    const rows = [
      ...Array.from({ length: 4 }, () => row('responded', { work_mode: 'remote' })),
      ...Array.from({ length: 4 }, () => row('applied', { work_mode: 'onsite' })),
    ];
    const r = computeInsights(rows);
    expect(r.notes.some(n => n.includes('remote'))).toBe(true);
  });

  it('handles the empty state without dividing by zero', () => {
    const r = computeInsights([]);
    expect(r.applied).toBe(0);
    expect(r.notes[0]).toMatch(/No applications yet/);
  });
});

describe('mode parsers', () => {
  it('parses a project eval and defaults bad verdicts to SKIP', () => {
    const good = parseProjectEval(JSON.stringify({
      verdict: 'PIVOT', score: 3.8, rationale: 'ok', pivot: 'narrower scope',
      dimensions: [{ name: 'uniqueness', score: 4, note: 'fresh' }],
      plan: ['week 1: MVP'], interviewPack: ['one-pager'],
    }));
    expect(good.verdict).toBe('PIVOT');
    expect(good.pivot).toBe('narrower scope');
    expect(good.dimensions).toHaveLength(1);
    expect(parseProjectEval('{"verdict":"MAYBE"}').verdict).toBe('SKIP');
  });

  it('parses a training eval with a timebox', () => {
    const r = parseTrainingEval(JSON.stringify({
      verdict: 'TIMEBOX', timeboxWeeks: 3, rationale: 'r',
      dimensions: [{ name: 'recruiter signal', assessment: 'weak' }],
      plan: [{ week: 1, deliverable: 'finish module 1' }],
    }));
    expect(r.verdict).toBe('TIMEBOX');
    expect(r.timeboxWeeks).toBe(3);
    expect(r.plan[0].deliverable).toMatch(/module 1/);
  });

  it('deep-research prompt interpolates company, role, and profile', () => {
    const p = buildDeepResearchPrompt('Acme', 'Data Analyst', { narrative: 'ops person', skills: ['sql', 'excel'] });
    expect(p).toContain('Acme');
    expect(p).toContain('Data Analyst');
    expect(p).toContain('sql');
    expect(p).toContain('ops person');
    expect(p).toContain('### 6. My angle');
  });
});

describe('outreach', () => {
  it('embeds the right framework per contact kind and the hard rules', () => {
    const msgs = buildOutreachPrompt(
      { name: 'Jane', title: 'Recruiter', kind: 'recruiter', company: 'Acme' },
      { narrative: 'n', skills: ['sql'], topAccomplishments: ['cut costs 30%'] },
      { title: 'Analyst' },
    );
    expect(msgs[0].content).toContain('screening questions');       // recruiter framework
    expect(msgs[0].content).toContain('Maximum 300 characters');
    expect(msgs[0].content).toContain('NEVER include a phone number');
    expect(msgs[1].content).toContain('cut costs 30%');
    const peer = buildOutreachPrompt({ kind: 'peer', company: 'Acme' }, {});
    expect(peer[0].content).toContain('NEVER ask for a job');
    const unknown = buildOutreachPrompt({ kind: 'gibberish', company: 'Acme' }, {});
    expect(unknown[0].content).toContain('low-pressure');           // falls back to "other"
  });

  it('parses and clamps outreach messages to 300 chars', () => {
    const r = parseOutreach(JSON.stringify({ message: 'x'.repeat(400), alternate: 'alt' }));
    expect(r.message).toHaveLength(300);
    expect(r.alternate).toBe('alt');
  });

  it('recovers names from LinkedIn slugs and search headings', () => {
    expect(nameFromSlugOrText('jane-doe-1a2b3c4d')).toBe('Jane Doe');
    expect(nameFromSlugOrText('Jane Doe - Senior Recruiter - Acme | LinkedIn')).toBe('Jane Doe');
    expect(nameFromSlugOrText('')).toBe('');
  });
});
