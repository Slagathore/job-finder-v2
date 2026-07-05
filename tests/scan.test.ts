import { describe, it, expect } from 'vitest';
import {
  detectApi, parseGreenhouse, parseAshby, parseLever, buildTitleFilter, inferWorkMode,
} from '../electron/scan/ats';

describe('detectApi', () => {
  it('detects greenhouse from job-boards url', () => {
    expect(detectApi({ name: 'X', url: 'https://job-boards.greenhouse.io/anthropic' }))
      .toEqual({ type: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs' });
  });
  it('detects greenhouse EU url', () => {
    expect(detectApi({ name: 'X', url: 'https://job-boards.eu.greenhouse.io/polyai' })?.type).toBe('greenhouse');
  });
  it('detects ashby from careers url', () => {
    expect(detectApi({ name: 'X', url: 'https://jobs.ashbyhq.com/cohere' }))
      .toEqual({ type: 'ashby', url: 'https://api.ashbyhq.com/posting-api/job-board/cohere?includeCompensation=true' });
  });
  it('detects lever', () => {
    expect(detectApi({ name: 'X', url: 'https://jobs.lever.co/mistral' }))
      .toEqual({ type: 'lever', url: 'https://api.lever.co/v0/postings/mistral' });
  });
  it('prefers explicit greenhouse api field', () => {
    expect(detectApi({ name: 'X', url: 'https://careers.x.com', api: 'https://boards-api.greenhouse.io/v1/boards/x/jobs' })?.type)
      .toBe('greenhouse');
  });
  it('returns null for unknown / branded careers pages', () => {
    expect(detectApi({ name: 'X', url: 'https://careers.salesforce.com' })).toBeNull();
  });
});

describe('parsers', () => {
  it('parses greenhouse', () => {
    const out = parseGreenhouse({ jobs: [{ title: 'AI Eng', absolute_url: 'u', location: { name: 'Remote' } }] }, 'Co');
    expect(out[0]).toMatchObject({ title: 'AI Eng', url: 'u', company: 'Co', location: 'Remote', source: 'greenhouse-api', workMode: 'remote' });
  });
  it('parses ashby', () => {
    const out = parseAshby({ jobs: [{ title: 'PM', jobUrl: 'u', location: 'Dallas, TX' }] }, 'Co');
    expect(out[0]).toMatchObject({ title: 'PM', url: 'u', source: 'ashby-api', workMode: null });
  });
  it('parses lever array', () => {
    const out = parseLever([{ text: 'SE', hostedUrl: 'u', categories: { location: 'Hybrid - NYC' } }], 'Co');
    expect(out[0]).toMatchObject({ title: 'SE', url: 'u', source: 'lever-api', workMode: 'hybrid' });
  });
  it('lever non-array yields empty', () => {
    expect(parseLever({}, 'Co')).toEqual([]);
  });
});

describe('inferWorkMode', () => {
  it('flags remote / hybrid / unknown', () => {
    expect(inferWorkMode('Fully Remote (US)')).toBe('remote');
    expect(inferWorkMode('Hybrid — Berlin')).toBe('hybrid');
    expect(inferWorkMode('London, UK')).toBeNull();
    expect(inferWorkMode('')).toBeNull();
  });
});

describe('buildTitleFilter', () => {
  it('keeps all when no positives', () => {
    const f = buildTitleFilter({ positive: [], negative: [] });
    expect(f('Anything')).toBe(true);
  });
  it('requires a positive and rejects negatives', () => {
    const f = buildTitleFilter({ positive: ['engineer'], negative: ['intern'] });
    expect(f('Software Engineer')).toBe(true);
    expect(f('Engineering Intern')).toBe(false);
    expect(f('Marketing Manager')).toBe(false);
  });
});
