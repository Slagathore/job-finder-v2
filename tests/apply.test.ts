import { describe, it, expect } from 'vitest';
import { parseTailored } from '../electron/apply/parse';
import { renderResumeHtml, renderCoverHtml } from '../electron/apply/render';

describe('parseTailored', () => {
  it('parses a full tailored doc', () => {
    const t = parseTailored(JSON.stringify({
      summary: 'Senior X', sections: [{ heading: 'Experience', bullets: ['Did A', 'Did B'] }],
      coverLetter: 'Dear team', selectedItemIds: [1, 2, 'x'],
    }));
    expect(t.summary).toBe('Senior X');
    expect(t.sections[0].bullets).toEqual(['Did A', 'Did B']);
    expect(t.selectedItemIds).toEqual([1, 2]); // non-int dropped
  });
  it('tolerates missing fields', () => {
    const t = parseTailored('{}');
    expect(t).toEqual({ summary: '', sections: [], coverLetter: '', selectedItemIds: [] });
  });
  it('drops malformed sections', () => {
    expect(parseTailored('{"sections":[{"heading":"OK","bullets":["b"]},{"nope":1}]}').sections).toHaveLength(1);
  });
});

const cand = { name: 'Cole T', email: 'c@x.com', phone: '555', location: 'Dallas', links: 'gh/cole' };
const doc = { summary: 'Great fit', sections: [{ heading: 'Experience', bullets: ['Built <thing> & shipped'] }], coverLetter: 'Para one.\n\nPara two.', selectedItemIds: [] };

describe('renderResumeHtml', () => {
  it('includes name, contact, summary, bullets, skills', () => {
    const html = renderResumeHtml(cand, { skills: ['Python', 'SQL'] }, doc);
    expect(html).toContain('Cole T');
    expect(html).toContain('c@x.com');
    expect(html).toContain('Great fit');
    expect(html).toContain('Experience');
    expect(html).toContain('Python · SQL');
  });
  it('escapes HTML in bullets', () => {
    const html = renderResumeHtml(cand, null, doc);
    expect(html).toContain('Built &lt;thing&gt; &amp; shipped');
    expect(html).not.toContain('<thing>');
  });
});

describe('renderCoverHtml', () => {
  it('includes the role, company, and letter paragraphs', () => {
    const html = renderCoverHtml(cand, { title: 'AI Engineer', company: 'Acme' }, doc);
    expect(html).toContain('AI Engineer');
    expect(html).toContain('Acme');
    expect(html).toContain('Para one.');
    expect(html).toContain('Para two.');
    expect(html).toContain('Cole T');
  });
});
