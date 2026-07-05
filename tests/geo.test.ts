import { describe, it, expect } from 'vitest';
import { haversineMiles } from '../electron/geo/distance';
import { lookupAreaCode } from '../electron/geo/areacodes';

describe('haversineMiles', () => {
  it('is 0 for the same point', () => {
    expect(haversineMiles(32.7767, -96.797, 32.7767, -96.797)).toBeCloseTo(0, 5);
  });
  it('Dallas → Fort Worth is ~30 miles', () => {
    const d = haversineMiles(32.7767, -96.7970, 32.7555, -97.3308);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });
  it('NYC → LA is ~2450 miles', () => {
    const d = haversineMiles(40.7128, -74.006, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2500);
  });
});

describe('lookupAreaCode', () => {
  it('resolves a known DFW code', () => {
    expect(lookupAreaCode('214')?.label).toBe('Dallas, TX');
    expect(lookupAreaCode('817')?.label).toBe('Fort Worth, TX');
  });
  it('returns null for unknown codes', () => {
    expect(lookupAreaCode('999')).toBeNull();
  });
});
