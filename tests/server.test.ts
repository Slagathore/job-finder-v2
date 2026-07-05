import { describe, it, expect, vi } from 'vitest';
import { handleRequest, type HubDeps } from '../electron/server/router';
import { normalizeJobUrl } from '../electron/ingest/url';

function deps(over: Partial<HubDeps> = {}): HubDeps {
  return {
    token: 'secret',
    ingestJobs: vi.fn(() => ({ added: 2, duplicates: 1, skipped: 0 })),
    ingestFields: vi.fn(() => ({ saved: 3 })),
    status: vi.fn(() => ({ jobs: 42 })),
    appVersion: '0.1.0',
    ...over,
  };
}

describe('handleRequest', () => {
  it('answers OPTIONS preflight', () => {
    expect(handleRequest('OPTIONS', '/ingest/jobs', {}, null, deps()).status).toBe(204);
  });

  it('serves /ping without a token', () => {
    const r = handleRequest('GET', '/ping', {}, null, deps());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, app: 'job-finder-v2' });
  });

  it('rejects ingest without the right token', () => {
    expect(handleRequest('POST', '/ingest/jobs', {}, { jobs: [] }, deps()).status).toBe(401);
    expect(handleRequest('POST', '/ingest/jobs', { 'x-jf-token': 'wrong' }, { jobs: [] }, deps()).status).toBe(401);
  });

  it('ingests jobs with a valid token', () => {
    const d = deps();
    const r = handleRequest('POST', '/ingest/jobs', { 'x-jf-token': 'secret' }, { jobs: [{ title: 'x', url: 'u' }] }, d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ added: 2, duplicates: 1, skipped: 0 });
    expect(d.ingestJobs).toHaveBeenCalledWith([{ title: 'x', url: 'u' }]);
  });

  it('routes scraper staleness reports (auth required)', () => {
    const stale = vi.fn();
    const r = handleRequest('POST', '/ingest/stale', { 'x-jf-token': 'secret' },
      { site: 'indeed', url: 'https://indeed.com/jobs?q=x' }, deps({ scraperStale: stale }));
    expect(r.status).toBe(200);
    expect(stale).toHaveBeenCalledWith('indeed', 'https://indeed.com/jobs?q=x');
    expect(handleRequest('POST', '/ingest/stale', {}, { site: 'indeed' }, deps()).status).toBe(401);
  });

  it('ingests fields + serves status, 404s unknown routes', () => {
    expect(handleRequest('POST', '/ingest/fields', { 'x-jf-token': 'secret' }, { fields: [{ label: 'a', value: 'b' }] }, deps()).body)
      .toEqual({ saved: 3 });
    expect(handleRequest('GET', '/status', { 'x-jf-token': 'secret' }, null, deps()).body).toEqual({ jobs: 42 });
    expect(handleRequest('GET', '/nope', { 'x-jf-token': 'secret' }, null, deps()).status).toBe(404);
  });
});

describe('normalizeJobUrl', () => {
  it('strips tracking params + hash, adds scheme', () => {
    expect(normalizeJobUrl('https://x.com/job?id=5&utm_source=g&trk=abc#top')).toBe('https://x.com/job?id=5');
    expect(normalizeJobUrl('//x.com/a?fbclid=1')).toBe('https://x.com/a');
  });
  it('passes through junk unchanged', () => {
    expect(normalizeJobUrl('not a url')).toBe('not a url');
    expect(normalizeJobUrl('')).toBe('');
  });
});
