import { describe, it, expect } from 'vitest';
import { slugsFor } from '../electron/boards/autodiscover';
import { socToSeriesId } from '../electron/intel/bls';

describe('slugsFor', () => {
  it('generates deduped slug candidates from company names', () => {
    expect(slugsFor('Blue Origin')).toEqual(['blueorigin', 'blue-origin', 'blue']);
    expect(slugsFor('Acme Inc')).toEqual(['acme']);
    expect(slugsFor('Datadog, Inc.')).toEqual(['datadog']);
    expect(slugsFor('')).toEqual([]);
  });
  it('drops too-short and non-url-safe fragments', () => {
    for (const s of slugsFor('A & B Consulting Co')) {
      expect(s.length).toBeGreaterThanOrEqual(3);
      expect(s).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('socToSeriesId', () => {
  it('builds the national cross-industry annual-median OEWS series id', () => {
    // Verified live against api.bls.gov (SOC 15-1252 → $135,980 for 2025).
    expect(socToSeriesId('15-1252')).toBe('OEUN000000000000015125213');
  });
});
