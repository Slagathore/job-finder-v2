import { describe, it, expect } from 'vitest';
import { computeFollowups, type FollowupInput } from '../electron/followup/cadence';
import { parsePrep } from '../electron/apply/prep-parse';

const DAY = 24 * 60 * 60 * 1000;
const now = 1_000_000_000_000;
const row = (o: Partial<FollowupInput>): FollowupInput => ({ appId: 1, jobId: 1, company: 'Co', title: 'T', state: 'applied', since: now, ...o });

describe('computeFollowups', () => {
  it('flags overdue applications by state threshold and sorts by age', () => {
    const f = computeFollowups([
      row({ appId: 1, state: 'applied', since: now - 8 * DAY }),    // due (>=7)
      row({ appId: 2, state: 'applied', since: now - 2 * DAY }),    // not due
      row({ appId: 3, state: 'interview', since: now - 4 * DAY }),  // due (>=3)
      row({ appId: 4, state: 'offer', since: now - 30 * DAY }),     // ignored state
    ], now);
    expect(f.map(x => x.appId)).toEqual([1, 3]);     // overdue only, oldest first
    expect(f[0].action).toMatch(/follow-up/i);
    expect(f[1].action).toMatch(/thank-you/i);
  });
  it('treats null since as now (not overdue)', () => {
    expect(computeFollowups([row({ since: null })], now)).toHaveLength(0);
  });
});

describe('parsePrep', () => {
  it('parses questions, stories and askThem; filters bad stories', () => {
    const p = parsePrep('{"questions":["Q1"],"stories":[{"q":"Tell me about X","a":"STAR"},{"q":1}],"askThem":["Ask1"]}');
    expect(p.questions).toEqual(['Q1']);
    expect(p.stories).toEqual([{ q: 'Tell me about X', a: 'STAR' }]);
    expect(p.askThem).toEqual(['Ask1']);
  });
  it('defaults to empty arrays', () => {
    expect(parsePrep('{}')).toEqual({ questions: [], stories: [], askThem: [] });
  });
});
