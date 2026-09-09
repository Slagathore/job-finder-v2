import { describe, it, expect } from 'vitest';
import { parseSalary, parseCompanyIntel, parseMoves, parseCerts, normalizeCert, ensurePromotionTrack } from '../electron/intel/parse';

describe('parseSalary', () => {
  it('parses numbers + clamps confidence', () => {
    expect(parseSalary('{"min":120000,"max":160000,"currency":"USD","confidence":"high","note":"x"}'))
      .toEqual({ min: 120000, max: 160000, currency: 'USD', confidence: 'high', note: 'x', soc: null });
    expect(parseSalary('{}')).toEqual({ min: null, max: null, currency: 'USD', confidence: 'low', note: '', soc: null });
    expect(parseSalary('{"confidence":"bogus"}').confidence).toBe('low');
  });
  it('normalizes SOC codes for BLS grounding', () => {
    expect(parseSalary('{"soc":"15-1252"}').soc).toBe('15-1252');
    expect(parseSalary('{"soc":"151252"}').soc).toBe('15-1252');
    expect(parseSalary('{"soc":"not a code"}').soc).toBeNull();
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

describe('parseMoves industries and titles', () => {
  it('keeps the industries and job titles a move makes you a candidate for', () => {
    const m = parseMoves('[{"role_family":"Solutions Engineer","industries":["SaaS","fintech",7],"titles":["Sales Engineer"]}]');
    expect(m[0].industries).toEqual(['SaaS', 'fintech']);
    expect(m[0].titles).toEqual(['Sales Engineer']);
  });
  it('throws instead of returning an empty list', () => {
    expect(() => parseMoves('I cannot answer that')).toThrow(/no usable moves/i);
    expect(() => parseMoves('[]')).toThrow(/no usable moves/i);
  });
});

describe('parseCerts', () => {
  it('parses + defaults lift/effort', () => {
    const c = parseCerts('[{"certificate":"AWS SA","lift":"high","effort":"medium","rationale":"r","confidence":"high"},{"certificate":"X"}]');
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ certificate: 'AWS SA', lift: 'high' });
    expect(c[1]).toMatchObject({ certificate: 'X', lift: 'medium', effort: 'medium' });
  });
  it('keeps the industries and titles the credential opens up', () => {
    const c = parseCerts('[{"certificate":"CCNA","industries":["networking"],"titles":["Network Technician"],"track":"promotion"}]');
    expect(c[0].industries).toEqual(['networking']);
    expect(c[0].titles).toEqual(['Network Technician']);
    expect(c[0].track).toBe('promotion');
  });
  it('always labels one promotion track option', () => {
    const c = parseCerts('[{"certificate":"A","lift":"low","effort":"high"},{"certificate":"B","lift":"high","effort":"low"}]');
    expect(c.filter(x => x.track === 'promotion')).toHaveLength(1);
    expect(c.find(x => x.track === 'promotion')?.certificate).toBe('B');
  });
  it('leaves the model own promotion pick alone', () => {
    const c = parseCerts('[{"certificate":"A","lift":"low","effort":"high","track":"promotion"},{"certificate":"B","lift":"high","effort":"low"}]');
    expect(c.find(x => x.track === 'promotion')?.certificate).toBe('A');
  });
  it('throws instead of returning an empty list', () => {
    expect(() => parseCerts('nothing here')).toThrow(/no usable credential advice/i);
  });
});

describe('normalizeCert', () => {
  it('fills the new fields in for rows cached before they existed', () => {
    const c = normalizeCert({ certificate: 'Old Row', lift: 'high' });
    expect(c).toMatchObject({ certificate: 'Old Row', lift: 'high', effort: 'medium', track: 'lateral' });
    expect(c.industries).toEqual([]);
    expect(c.titles).toEqual([]);
  });
});

describe('ensurePromotionTrack', () => {
  it('is a no-op on an empty set', () => {
    expect(ensurePromotionTrack([])).toEqual([]);
  });
});
