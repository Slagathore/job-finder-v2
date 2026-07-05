import { describe, it, expect } from 'vitest';
import { buildAuthUrl } from '../electron/gmail/auth';
import { parseMessage, decodeB64Url } from '../electron/gmail/client';
import { parseClassification, stateForClassification } from '../electron/gmail/classify';
import { matchEmailToApplication, type AppRow } from '../electron/gmail/match';

describe('buildAuthUrl', () => {
  it('includes client_id, redirect, offline access + consent', () => {
    const url = buildAuthUrl('cid123', 'http://127.0.0.1:17893/oauth/callback');
    expect(url).toContain('client_id=cid123');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain(encodeURIComponent('http://127.0.0.1:17893/oauth/callback'));
    expect(url).toContain(encodeURIComponent('gmail.readonly'));
  });
});

describe('parseMessage', () => {
  it('extracts headers + decodes the text/plain part', () => {
    const b64 = Buffer.from('Thanks for applying to Acme!').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const msg = {
      id: 'm1', snippet: 'Thanks…',
      payload: {
        headers: [{ name: 'From', value: 'jobs@acme.com' }, { name: 'Subject', value: 'Your application' }, { name: 'Date', value: 'Mon, 1 Jan 2026' }],
        parts: [{ mimeType: 'text/html', body: { data: '' } }, { mimeType: 'text/plain', body: { data: b64 } }],
      },
    };
    const e = parseMessage(msg);
    expect(e).toMatchObject({ id: 'm1', from: 'jobs@acme.com', subject: 'Your application' });
    expect(e.body).toBe('Thanks for applying to Acme!');
  });
  it('decodeB64Url tolerates junk', () => { expect(decodeB64Url('')).toBe(''); });

  it('strips HTML when there is no text/plain part', () => {
    const html = Buffer.from('<div><style>x{}</style><b>Hi &amp; welcome</b></div>').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const e = parseMessage({ id: 'm', payload: { headers: [{ name: 'Subject', value: 's' }], mimeType: 'text/html', body: { data: html } } });
    expect(e.body).toBe('Hi & welcome');
  });
});

describe('parseClassification + stateForClassification', () => {
  it('parses class + company and maps to pipeline state', () => {
    const r = parseClassification('{"classification":"interview","company":"Acme"}');
    expect(r).toEqual({ classification: 'interview', company: 'Acme' });
    expect(stateForClassification('interview')).toBe('interview');
    expect(stateForClassification('rejection')).toBe('rejected');
    expect(stateForClassification('ack')).toBe('responded');
    expect(stateForClassification('other')).toBeNull();
  });
  it('falls back to other for unknown', () => {
    expect(parseClassification('{"classification":"weird"}').classification).toBe('other');
  });
});

describe('matchEmailToApplication', () => {
  const apps: AppRow[] = [{ appId: 1, jobId: 10, company: 'Acme Inc' }, { appId: 2, jobId: 20, company: 'Globex' }];
  it('matches by company in the email', () => {
    const e: any = { from: 'careers@acme.com', subject: 'Update', body: 'Acme team' };
    expect(matchEmailToApplication(e, null, apps)?.jobId).toBe(10);
  });
  it('matches via the LLM company hint', () => {
    const e: any = { from: 'noreply@greenhouse.io', subject: 'Update', body: 'regarding your application' };
    expect(matchEmailToApplication(e, 'Globex', apps)?.jobId).toBe(20);
  });
  it('returns null with no match', () => {
    const e: any = { from: 'x@y.com', subject: 'hi', body: 'nothing' };
    expect(matchEmailToApplication(e, null, apps)).toBeNull();
  });
});
