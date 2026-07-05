import { describe, it, expect } from 'vitest';
import { detectRoute } from '../electron/apply/route';
import { classifyLiveness } from '../electron/apply/liveness';

describe('detectRoute', () => {
  it('routes by host', () => {
    expect(detectRoute('https://www.linkedin.com/jobs/view/123')).toBe('easyapply');
    expect(detectRoute('https://boards.greenhouse.io/x/jobs/1')).toBe('ats');
    expect(detectRoute('https://jobs.ashbyhq.com/x')).toBe('ats');
    expect(detectRoute('https://jobs.lever.co/x/1')).toBe('ats');
    expect(detectRoute('https://acme.com/careers/eng')).toBe('external');
    expect(detectRoute('')).toBe('external');
  });
});

describe('classifyLiveness', () => {
  it('flags unreachable and closed postings', () => {
    expect(classifyLiveness('')).toMatchObject({ live: false, reason: 'unreachable' });
    expect(classifyLiveness('<h1>This job is no longer accepting applications</h1>').live).toBe(false);
    expect(classifyLiveness('<title>Page not found</title>').live).toBe(false);
    expect(classifyLiveness('This position has been filled').live).toBe(false);
  });
  it('treats a normal posting as live', () => {
    expect(classifyLiveness('<h1>Senior AI Engineer</h1><button>Apply now</button>')).toMatchObject({ live: true });
  });
});
