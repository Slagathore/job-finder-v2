import { describe, it, expect } from 'vitest';
import { extractJsonLdJobs } from '../electron/boards/jsonld';
import { parseAdapter, applyAdapter } from '../electron/boards/learn';

describe('extractJsonLdJobs', () => {
  it('parses a single JobPosting', () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"JobPosting","title":"AI Engineer",
       "url":"https://x.com/j/1","hiringOrganization":{"name":"Acme"},
       "jobLocation":{"address":{"addressLocality":"Dallas","addressRegion":"TX"}}}
    </script></head></html>`;
    const jobs = extractJsonLdJobs(html, 'https://x.com');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ title: 'AI Engineer', company: 'Acme', location: 'Dallas, TX', source: 'jsonld' });
    expect(jobs[0].url).toBe('https://x.com/j/1');
  });

  it('parses an ItemList + flags TELECOMMUTE as remote, and dedups', () => {
    const html = `<script type="application/ld+json">
      {"@type":"ItemList","itemListElement":[
        {"item":{"@type":"JobPosting","title":"PM","url":"https://x.com/j/2","jobLocationType":"TELECOMMUTE"}},
        {"item":{"@type":"JobPosting","title":"PM dup","url":"https://x.com/j/2"}}
      ]}</script>`;
    const jobs = extractJsonLdJobs(html, 'https://x.com');
    expect(jobs).toHaveLength(1);          // deduped by url
    expect(jobs[0].workMode).toBe('remote');
  });

  it('resolves relative urls + handles @graph', () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"JobPosting","title":"SE","url":"/jobs/9"}]}</script>`;
    expect(extractJsonLdJobs(html, 'https://co.com/careers')[0].url).toBe('https://co.com/jobs/9');
  });

  it('ignores invalid json blocks', () => {
    expect(extractJsonLdJobs('<script type="application/ld+json">{bad</script>', 'https://x.com')).toEqual([]);
  });
});

describe('parseAdapter', () => {
  it('accepts complete selectors, rejects incomplete', () => {
    expect(parseAdapter('{"list":".job","title":".t","url":"a"}')).toMatchObject({ list: '.job', title: '.t', url: 'a' });
    expect(parseAdapter('{"list":".job"}')).toBeNull();
  });
});

describe('applyAdapter', () => {
  it('extracts cards via cheerio and absolutizes hrefs', () => {
    const html = `<ul>
      <li class="job"><a class="t" href="/job/1">Engineer</a><span class="co">Acme</span><span class="loc">Remote</span></li>
      <li class="job"><a class="t" href="https://x.com/job/2">Designer</a><span class="co">Acme</span><span class="loc">NYC</span></li>
      <li class="job"><span class="t"></span></li>
    </ul>`;
    const jobs = applyAdapter(html, { list: 'li.job', title: '.t', url: '.t', company: '.co', location: '.loc' }, 'https://x.com/careers');
    expect(jobs).toHaveLength(2);                 // empty card skipped
    expect(jobs[0]).toMatchObject({ title: 'Engineer', url: 'https://x.com/job/1', company: 'Acme', location: 'Remote', workMode: 'remote', source: 'dom-adapter' });
    expect(jobs[1].url).toBe('https://x.com/job/2');
  });
});
