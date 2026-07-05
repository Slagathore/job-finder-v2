import type { TailoredDoc } from './parse';

export interface Candidate {
  name: string; email?: string; phone?: string; location?: string; links?: string;
}

function esc(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const STYLE = `
  body{font:13px/1.5 Georgia,'Times New Roman',serif;color:#1a1a1a;max-width:760px;margin:36px auto;padding:0 28px;}
  h1{font-size:24px;margin:0 0 2px;} .contact{color:#555;font-size:12px;margin-bottom:14px;}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #ccc;
     padding-bottom:3px;margin:18px 0 8px;}
  ul{margin:6px 0 6px 18px;padding:0;} li{margin:3px 0;}
  .summary{margin:6px 0 4px;} .skills{font-size:12px;color:#333;}
  p{margin:8px 0;} .sig{margin-top:18px;}
`;

function contactLine(c: Candidate): string {
  return [c.email, c.phone, c.location, c.links].filter(Boolean).map(esc).join('  ·  ');
}

export function renderResumeHtml(c: Candidate, profile: { skills?: string[] } | null, t: TailoredDoc): string {
  const sections = t.sections.map(s => `
    <h2>${esc(s.heading)}</h2>
    <ul>${s.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`).join('');
  const skills = (profile?.skills ?? []).length
    ? `<h2>Skills</h2><p class="skills">${(profile!.skills ?? []).map(esc).join(' · ')}</p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
    <h1>${esc(c.name || 'Your Name')}</h1>
    <div class="contact">${contactLine(c)}</div>
    ${t.summary ? `<p class="summary">${esc(t.summary)}</p>` : ''}
    ${sections}
    ${skills}
  </body></html>`;
}

export function renderCoverHtml(c: Candidate, job: { title: string; company: string }, t: TailoredDoc): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const body = (t.coverLetter || '').split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
    <div class="contact">${esc(c.name || 'Your Name')} — ${contactLine(c)}</div>
    <p>${esc(date)}</p>
    <p>Re: ${esc(job.title)} at ${esc(job.company)}</p>
    ${body}
    <div class="sig">Sincerely,<br>${esc(c.name || 'Your Name')}</div>
  </body></html>`;
}
