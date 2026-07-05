import { describe, it, expect } from 'vitest';
import { columnForState, groupIntoColumns, PIPELINE_COLUMNS } from '../electron/pipeline/columns';

describe('columnForState', () => {
  it('maps canonical states to themselves', () => {
    expect(columnForState('applied')).toBe('applied');
    expect(columnForState('interview')).toBe('interview');
  });
  it('defaults null/unknown to discovered', () => {
    expect(columnForState(null)).toBe('discovered');
    expect(columnForState('')).toBe('discovered');
    expect(columnForState('whatever')).toBe('discovered');
  });
  it('aliases evaluated→discovered and discarded/skip→rejected', () => {
    expect(columnForState('evaluated')).toBe('discovered');
    expect(columnForState('discarded')).toBe('rejected');
    expect(columnForState('SKIP')).toBe('rejected');
  });
});

describe('groupIntoColumns', () => {
  it('buckets rows by state and keeps all columns present', () => {
    const g = groupIntoColumns([
      { id: 1, state: 'applied' }, { id: 2, state: null }, { id: 3, state: 'applied' }, { id: 4, state: 'offer' },
    ]);
    expect(Object.keys(g)).toEqual([...PIPELINE_COLUMNS]);
    expect(g.applied.map(r => r.id)).toEqual([1, 3]);
    expect(g.discovered.map(r => r.id)).toEqual([2]);
    expect(g.offer).toHaveLength(1);
    expect(g.interview).toEqual([]);
  });
});
