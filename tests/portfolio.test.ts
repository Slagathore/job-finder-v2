import { describe, it, expect } from 'vitest';
import {
  buildPortfolioPrompt, clusterProjectItems, parsePortfolioReview, portfolioSignature, sourceLabel,
} from '../electron/intel/portfolio-prompt';

const items = [
  { id: 1, text: 'Built a local-first Electron app with SQLite', source_ref: 'github:Slagathore/job_finder_v2' },
  { id: 2, text: 'Wrote a scraper adapter learner', source_ref: 'github:Slagathore/job_finder_v2|folder:C:\\code\\jf' },
  { id: 3, text: 'Shipped a Chrome extension', source_ref: 'github:Slagathore/other' },
  { id: 4, text: 'Loose item with no provenance', source_ref: null },
];

describe('sourceLabel', () => {
  it('keeps owner/repo for github refs and trims paths', () => {
    expect(sourceLabel('github:Slagathore/job_finder_v2')).toBe('Slagathore/job_finder_v2');
    expect(sourceLabel('folder:C:\\code\\stuff\\thing')).toBe('stuff/thing');
    expect(sourceLabel('')).toBe('Unfiled work');
  });
});

describe('clusterProjectItems', () => {
  it('groups by the first source ref, biggest cluster first', () => {
    const c = clusterProjectItems(items);
    expect(c).toHaveLength(3);
    expect(c[0].source).toBe('github:Slagathore/job_finder_v2');
    expect(c[0].lines).toHaveLength(2);
    expect(c.find(x => x.source === '')?.lines).toEqual(['Loose item with no provenance']);
  });
  it('drops empty text', () => {
    expect(clusterProjectItems([{ text: '  ', source_ref: 'github:a/b' }])).toHaveLength(0);
  });
});

describe('portfolioSignature', () => {
  it('is stable for the same portfolio and changes when it does', () => {
    const a = portfolioSignature(items);
    expect(portfolioSignature([...items].reverse())).toBe(a);
    expect(portfolioSignature(items.slice(0, 2))).not.toBe(a);
  });
});

describe('buildPortfolioPrompt', () => {
  it('sends the clustered projects and the profile context', () => {
    const msgs = buildPortfolioPrompt(clusterProjectItems(items), { narrative: 'builds tools', skills: ['sqlite'], seniority: 'mid' });
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toContain('Slagathore/job_finder_v2');
    expect(msgs[1].content).toContain('builds tools');
  });
});

const GOOD = JSON.stringify({
  summary: 'Real shipping evidence, thin on teamwork.',
  projects: [{
    project: 'job_finder_v2', source: 'github:Slagathore/job_finder_v2',
    proves: 'Can ship a desktop app end to end.',
    roles: ['Application Developer'], industries: ['software'],
    resume_line: 'Built a local first desktop job search app on Electron and SQLite.',
    weaknesses: ['no users', 'solo work only'], strength: 'high',
  }],
  themes: [{ theme: 'ships alone', evidence: ['job_finder_v2'], sells_to: ['small product teams'] }],
  gap: { gap: 'no team work', why: 'hiring managers look for collaboration', first_step: 'contribute to an open source repo' },
});

describe('parsePortfolioReview', () => {
  it('parses the full shape', () => {
    const r = parsePortfolioReview(GOOD);
    expect(r.projects[0]).toMatchObject({ project: 'job_finder_v2', strength: 'high' });
    expect(r.projects[0].roles).toEqual(['Application Developer']);
    expect(r.themes[0].theme).toBe('ships alone');
    expect(r.gap?.first_step).toContain('open source');
  });
  it('defaults an unknown strength to medium and drops junk entries', () => {
    const r = parsePortfolioReview('{"projects":[{"project":"x","strength":"enormous"},{"nope":1}],"themes":[]}');
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0].strength).toBe('medium');
  });
  it('throws instead of returning an empty review', () => {
    expect(() => parsePortfolioReview('sorry, I cannot help with that')).toThrow(/no usable portfolio review/i);
    expect(() => parsePortfolioReview('{"projects":[],"themes":[]}')).toThrow(/no usable portfolio review/i);
  });
});
