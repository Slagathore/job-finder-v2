import { describe, it, expect } from 'vitest';
import { parseSalary, parseCompanyIntel, parseMoves, parseCerts } from '../electron/intel/parse';

describe('parseSalary', () => {
  it('parses numbers + clamps confidence', () => {
    expect(parseSalary('{"min":120000,"max":160000,"currency":"USD","confidence":"high","note":"x"}'))
      .toEqual({ min: 120000, max: 160000, currency: 'USD', confidence: 'high', note: 'x' });
    expect(parseSalary('{}')).toEqual({ min: null, max: null, currency: 'USD', confidence: 'low', note: '' });
    expect(parseSalary('{"confidence":"bogus"}').confidence).toBe('low');
  });
});

describe('parseCompanyIntel', () => {
  it('clamps rating 0..5 and arrays', () => {
    const r = parseCompanyIntel('{"rating":7,"pros":["a"],"cons":["b"],"summary":"s","confidence":"medium"}', 'Acme');
    expect(r.rating).toBe(5);
    expect(r.pros).toEqual(['a']); expect(r.cons).toEqual(['b']);
    expect(r.company).toBe('Acme'); expect(r.source).toBe('llm-estimate');
  });
});

describe('parseMoves', () => {
  it('filters invalid + caps fields', () => {
    const m = parseMoves('[{"role_family":"Solutions Engineer","industry":"SaaS","rationale":"r","pay_outlook":"high","remote_friendly":true,"confidence":"medium"},{"nope":1}]');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ role_family: 'Solutions Engineer', pay_outlook: 'high', remote_friendly: true });
  });
});

describe('parseCerts', () => {
  it('parses + defaults lift/effort', () => {
    const c = parseCerts('[{"certificate":"AWS SA","lift":"high","effort":"medium","rationale":"r","confidence":"high"},{"certificate":"X"}]');
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ certificate: 'AWS SA', lift: 'high' });
    expect(c[1]).toMatchObject({ certificate: 'X', lift: 'medium', effort: 'medium' });
  });
});
