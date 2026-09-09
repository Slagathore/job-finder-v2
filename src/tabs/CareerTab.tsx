import React, { useEffect, useState } from 'react';
import { confirmDialog, toast } from '../lib/feedback';
import { CareerDirectionCard } from '../components/CareerDirectionCard';
import type { PortfolioResult } from '../types';

const pill = (v: string) => <span className={`pill pill-${v}`}>{v}</span>;
const pct = (r: number) => `${Math.round(r * 100)}%`;

function BucketTable({ title, buckets }: { title: string; buckets: any[] }) {
  if (!buckets?.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <b className="small">{title}</b>
      <table className="jobs"><thead><tr><th>Segment</th><th>Applied</th><th>Responded</th><th>Interviews</th><th>Response rate</th></tr></thead>
        <tbody>{buckets.map((b, i) => (
          <tr key={i}><td>{b.label}</td><td>{b.applied}</td><td>{b.responded}</td><td>{b.interviews}</td><td>{pct(b.rate)}</td></tr>))}</tbody></table>
    </div>
  );
}

export function CareerTab({ active }: { active: boolean }) {
  const [watch, setWatch] = useState<any[]>([]);
  const [watchName, setWatchName] = useState('');
  const [watchLoading, setWatchLoading] = useState(true);
  useEffect(() => { window.api.watch.list().then(setWatch).finally(() => setWatchLoading(false)); }, []);
  async function addWatch() { if (!watchName.trim()) return; await window.api.watch.add(watchName.trim()); setWatchName(''); setWatch(await window.api.watch.list()); }
  async function rmWatch(id: number, label: string) {
    const ok = await confirmDialog({ title: 'Stop watching', message: `Stop watching "${label}"?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await window.api.watch.remove(id); setWatch(await window.api.watch.list());
  }
  const [moves, setMoves] = useState<any[] | null>(null);
  const [field, setField] = useState('');
  const [certs, setCerts] = useState<any[] | null>(null);
  const [company, setCompany] = useState('');
  const [intel, setIntel] = useState<any>(null);
  const [busy, setBusy] = useState('');

  // ── Insights (rejection-pattern analytics) ──────────────────────────
  const [insights, setInsights] = useState<any>(null);
  async function loadInsights() {
    setBusy('insights');
    try { setInsights(await window.api.career.insights()); } finally { setBusy(''); }
  }

  // ── Contacts & outreach ─────────────────────────────────────────────
  const [contacts, setContacts] = useState<any[]>([]);
  const [cCompany, setCCompany] = useState('');
  const [cName, setCName] = useState('');
  const [cKind, setCKind] = useState('recruiter');
  const [cUrl, setCUrl] = useState('');
  const [discRole, setDiscRole] = useState('');
  const [outreach, setOutreach] = useState<{ id: number; message: string; alternate: string } | null>(null);
  const refreshContacts = () => window.api.contacts.list().then(setContacts);
  useEffect(() => { refreshContacts(); }, []);

  async function addContactManual() {
    if (!cCompany.trim()) { toast('Company is required', 'error'); return; }
    const r = await window.api.contacts.add({ company: cCompany, name: cName, kind: cKind, linkedin_url: cUrl });
    if (r?.error) { toast(r.error, 'error'); return; }
    setCName(''); setCUrl('');
    refreshContacts();
  }
  async function discover() {
    if (!cCompany.trim()) { toast('Enter a company to discover contacts for', 'error'); return; }
    setBusy('discover');
    const r = await window.api.contacts.discover(cCompany.trim(), discRole.trim() || undefined);
    setBusy('');
    if ('error' in r) { toast(r.error, 'error'); return; }
    const severity: 'success' | 'info' | 'error' = r.diagnosis === 'ok' ? (r.added.length ? 'success' : 'info')
      : r.diagnosis === 'no-results' ? 'info' : 'error';
    const suffix = r.diagnosis === 'ok' ? `, ${r.added.length} new` : '';
    toast(`${r.message}${suffix}`, severity);
    refreshContacts();
  }
  async function rmContact(id: number, label: string) {
    const ok = await confirmDialog({ title: 'Delete contact', message: `Delete "${label}"?`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await window.api.contacts.delete(id); refreshContacts();
  }
  async function draft(id: number) {
    setBusy(`outreach-${id}`);
    const r = await window.api.contacts.outreach(id);
    setBusy('');
    if ('error' in r) { toast(r.error, 'error'); return; }
    setOutreach({ id, ...r });
  }
  const copy = (text: string) => { navigator.clipboard.writeText(text).then(() => toast('Copied', 'success')); };

  // ── Prompt modes ────────────────────────────────────────────────────
  const [idea, setIdea] = useState('');
  const [projEval, setProjEval] = useState<any>(null);
  const [course, setCourse] = useState('');
  const [trainEval, setTrainEval] = useState<any>(null);
  const [deepCompany, setDeepCompany] = useState('');
  const [deepRole, setDeepRole] = useState('');
  const [deepPrompt, setDeepPrompt] = useState('');

  async function runProject() {
    if (!idea.trim()) return;
    setBusy('project');
    const r = await window.api.career.project(idea.trim());
    setBusy('');
    if ('error' in r) toast(r.error, 'error'); else setProjEval(r.eval);
  }
  async function runTraining() {
    if (!course.trim()) return;
    setBusy('training');
    const r = await window.api.career.training(course.trim());
    setBusy('');
    if ('error' in r) toast(r.error, 'error'); else setTrainEval(r.eval);
  }
  async function runDeep() {
    if (!deepCompany.trim() || !deepRole.trim()) { toast('Company and role are both required', 'error'); return; }
    const r = await window.api.career.deep(deepCompany.trim(), deepRole.trim());
    if ('error' in r) toast(r.error, 'error'); else setDeepPrompt(r.prompt);
  }

  // ── Portfolio review (what the ingested projects actually prove) ────
  // Re-read on every visit to this tab (not just on first mount): tabs stay
  // mounted once visited, so a mount-only read would freeze on whatever was
  // true the first time the user looked, e.g. "no project items yet" from
  // before a repo scan had finished.
  const [portfolio, setPortfolio] = useState<PortfolioResult | null>(null);
  const [portfolioNote, setPortfolioNote] = useState('');
  const [portfolioNoteReason, setPortfolioNoteReason] = useState<'no-projects' | 'no-review' | null>(null);
  const [portfolioError, setPortfolioError] = useState('');
  useEffect(() => {
    if (!active) return;
    window.api.intel.portfolio().then(r => {
      if ('empty' in r) { setPortfolio(null); setPortfolioNote(r.message); setPortfolioNoteReason(r.reason); }
      else { setPortfolio(r); setPortfolioNote(''); setPortfolioNoteReason(null); }
    }).catch(e => { setPortfolioNote(`Could not load the portfolio review: ${String(e?.message ?? e)}`); setPortfolioNoteReason(null); });
  }, [active]);
  async function runPortfolio(force: boolean) {
    setBusy('portfolio');
    const r = await window.api.intel.portfolioRun(force);
    setBusy('');
    if ('error' in r) { setPortfolioError(r.error); toast(r.error, 'error'); return; }
    setPortfolioError('');
    if ('empty' in r) { setPortfolio(null); setPortfolioNote(r.message); setPortfolioNoteReason(r.reason); return; }
    setPortfolio(r); setPortfolioNote(''); setPortfolioNoteReason(null);
  }

  async function loadMoves() {
    setBusy('moves');
    const r = await window.api.intel.moves();
    setBusy('');
    if ('error' in r) toast(r.error, 'error'); else setMoves(r.moves);
  }
  async function loadCerts() {
    if (!field.trim()) return;
    setBusy('certs');
    const r = await window.api.intel.certs(field.trim());
    setBusy('');
    if ('error' in r) toast(r.error, 'error'); else setCerts(r.certs);
  }
  async function loadCompany() {
    if (!company.trim()) return;
    setBusy('company');
    const r = await window.api.intel.company(company.trim());
    setBusy('');
    if ('error' in r) toast(r.error, 'error'); else setIntel(r);
  }

  return (
    <div className="panel" style={{ maxWidth: 920 }}>
      <h1>Career intelligence</h1>
      <p className="muted small">All figures are <b>LLM estimates with confidence labels</b> (real Glassdoor data would come via the extension; not fetched live here).</p>

      <CareerDirectionCard />

      <div className="profile-card">
        <h2>Portfolio review</h2>
        <p className="muted small">
          What the projects you have already ingested actually prove, which roles they are real evidence for,
          and the one line to put each of them on a resume.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="primary" onClick={() => runPortfolio(false)} disabled={!!busy || portfolioNoteReason === 'no-projects'}>
            {busy === 'portfolio' ? 'Reading your projects…' : portfolio ? 'Show the review' : 'Review my portfolio'}
          </button>
          {portfolio && <button onClick={() => runPortfolio(true)} disabled={!!busy}>Run it again</button>}
          {portfolio && <span className="muted small">{portfolio.projectCount} projects, {portfolio.itemCount} line items</span>}
        </div>
        {portfolioNote && <p className="small" style={{ marginTop: 8 }}>{portfolioNote}</p>}
        {portfolioError && (
          <p className="small msg-error" style={{ marginTop: 8 }}>
            The last run failed: {portfolioError}
          </p>
        )}
        {portfolio && (
          <div style={{ marginTop: 10 }}>
            {portfolio.review.summary && <p>{portfolio.review.summary}</p>}
            {portfolio.review.projects.map((p, i) => (
              <div key={i} style={{ marginTop: 10 }}>
                <b>{p.project}</b> {pill(p.strength)}
                {p.source && <span className="muted small"> · {p.source}</span>}
                <p className="small" style={{ margin: '4px 0' }}>{p.proves}</p>
                {p.resume_line && (
                  <p className="small" style={{ margin: '4px 0' }}>
                    <b>Resume line:</b> {p.resume_line} <button className="link" onClick={() => copy(p.resume_line)}>copy</button>
                  </p>
                )}
                {p.roles.length > 0 && <p className="muted small" style={{ margin: '2px 0' }}>Evidence for: {p.roles.join(', ')}</p>}
                {p.industries.length > 0 && <p className="muted small" style={{ margin: '2px 0' }}>Industries: {p.industries.join(', ')}</p>}
                {p.weaknesses.length > 0 && (
                  <ul className="rules">{p.weaknesses.map((w, k) => <li key={k}>{w}</li>)}</ul>
                )}
              </div>
            ))}
            {portfolio.review.themes.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <b className="small">Strongest themes</b>
                <ul className="rules">
                  {portfolio.review.themes.map((t, i) => (
                    <li key={i}>
                      <b>{t.theme}</b>
                      {t.sells_to.length > 0 && <span className="muted small"> · sells to {t.sells_to.join(', ')}</span>}
                      {t.evidence.length > 0 && <div className="muted small">{t.evidence.join(' · ')}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {portfolio.review.gap && (
              <p className="small" style={{ marginTop: 8 }}>
                <b>Biggest gap to fill next:</b> {portfolio.review.gap.gap}. {portfolio.review.gap.why} Start with: {portfolio.review.gap.first_step}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="profile-card">
        <h2>Application insights</h2>
        <p className="muted small">Response-rate patterns across everything you've applied to, by fit grade, work mode, and source.</p>
        <button className="primary" onClick={loadInsights} disabled={!!busy}>{busy === 'insights' ? '…' : 'Analyze my outcomes'}</button>
        {insights && (
          <div>
            <p style={{ marginTop: 10 }}>
              <b>{insights.applied}</b> applied · <b>{insights.responded}</b> responded · <b>{insights.interviews}</b> interviews · <b>{insights.offers}</b> offers · <b>{insights.rejected}</b> rejected · <b>{insights.pending}</b> pending
            </p>
            {insights.notes.map((n: string, i: number) => <p key={i} className="small" style={{ margin: '4px 0' }}>💡 {n}</p>)}
            <BucketTable title="By fit grade" buckets={insights.byFit} />
            <BucketTable title="By work mode" buckets={insights.byWorkMode} />
            <BucketTable title="By source" buckets={insights.bySource} />
          </div>
        )}
      </div>

      <div className="profile-card">
        <h2>Contacts &amp; outreach</h2>
        <p className="muted small">Track recruiters and hiring managers, auto-discover them via Google, and draft a 300-char LinkedIn message that doesn't sound like everyone else's.</p>
        <div className="addform">
          <input placeholder="company" value={cCompany} onChange={e => setCCompany(e.target.value)} />
          <input placeholder="role (optional, sharpens discovery)" value={discRole} onChange={e => setDiscRole(e.target.value)} />
          <button className="primary" onClick={discover} disabled={!!busy}>{busy === 'discover' ? 'Searching…' : 'Discover contacts'}</button>
        </div>
        <div className="addform">
          <input placeholder="name (manual add)" value={cName} onChange={e => setCName(e.target.value)} />
          <select value={cKind} onChange={e => setCKind(e.target.value)}>
            <option value="recruiter">recruiter</option><option value="hiring-manager">hiring manager</option>
            <option value="peer">peer</option><option value="interviewer">interviewer</option><option value="other">other</option>
          </select>
          <input placeholder="linkedin url (optional)" value={cUrl} onChange={e => setCUrl(e.target.value)} />
          <button onClick={addContactManual}>Add manually</button>
        </div>
        {contacts.length > 0 && (
          <table className="jobs"><thead><tr><th>Name</th><th>Company</th><th>Kind</th><th></th></tr></thead>
            <tbody>{contacts.map(c => (
              <tr key={c.id}>
                <td>{c.linkedin_url
                  ? <a href="#" onClick={e => { e.preventDefault(); window.api.app.openExternal(c.linkedin_url); }}>{c.name || c.linkedin_url}</a>
                  : (c.name || '—')}
                  {c.source === 'discovered' && <span className="muted small"> · found</span>}</td>
                <td className="muted small">{c.company}{c.title ? ` · ${c.title}` : ''}</td>
                <td>{pill(c.kind)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="link" onClick={() => draft(c.id)} disabled={!!busy}>{busy === `outreach-${c.id}` ? '…' : 'Draft outreach'}</button>
                  <button className="link" aria-label={`Delete ${c.name || c.company}`} onClick={() => rmContact(c.id, c.name || c.company)}>×</button>
                </td>
              </tr>))}</tbody></table>
        )}
        {outreach && (
          <div style={{ marginTop: 10 }}>
            <b className="small">Draft ({outreach.message.length}/300 chars)</b>
            <p style={{ margin: '4px 0' }}>{outreach.message} <button className="link" onClick={() => copy(outreach.message)}>copy</button></p>
            {outreach.alternate && <>
              <b className="small">Alternate angle</b>
              <p style={{ margin: '4px 0' }}>{outreach.alternate} <button className="link" onClick={() => copy(outreach.alternate)}>copy</button></p>
            </>}
          </div>
        )}
      </div>

      <div className="profile-card">
        <h2>Project idea evaluator</h2>
        <p className="muted small">Scores a project you are thinking about building. For a read on the projects you already have, use Portfolio review above.</p>
        <div className="addform">
          <input placeholder="project idea (e.g. local-first RAG search over my notes)" value={idea} onChange={e => setIdea(e.target.value)} />
          <button className="primary" onClick={runProject} disabled={!!busy}>{busy === 'project' ? '…' : 'Evaluate'}</button>
        </div>
        {projEval && (
          <div>
            <p><b>{projEval.verdict}</b>{projEval.pivot ? ` → ${projEval.pivot}` : ''} · weighted {Number(projEval.score).toFixed(1)}/5</p>
            <p className="muted small">{projEval.rationale}</p>
            <table className="jobs"><tbody>{projEval.dimensions.map((d: any, i: number) => (
              <tr key={i}><td>{d.name}</td><td>{d.score}/5</td><td className="muted small">{d.note}</td></tr>))}</tbody></table>
            {projEval.plan?.length > 0 && <><b className="small">80/20 plan</b><ul className="rules">{projEval.plan.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul></>}
            {projEval.interviewPack?.length > 0 && <><b className="small">Interview pack</b><ul className="rules">{projEval.interviewPack.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul></>}
          </div>
        )}
      </div>

      <div className="profile-card">
        <h2>Course &amp; cert evaluator</h2>
        <div className="addform">
          <input placeholder="course or certification (e.g. AWS SAA, Google PM cert)" value={course} onChange={e => setCourse(e.target.value)} />
          <button className="primary" onClick={runTraining} disabled={!!busy}>{busy === 'training' ? '…' : 'Evaluate'}</button>
        </div>
        {trainEval && (
          <div>
            <p><b>{trainEval.verdict === 'DONT' ? "DON'T" : trainEval.verdict}</b>{trainEval.timeboxWeeks ? ` (max ${trainEval.timeboxWeeks} weeks)` : ''}</p>
            <p className="muted small">{trainEval.rationale}</p>
            {trainEval.alternative && <p className="small"><b>Better use of the time:</b> {trainEval.alternative}</p>}
            <table className="jobs"><tbody>{trainEval.dimensions.map((d: any, i: number) => (
              <tr key={i}><td>{d.name}</td><td className="muted small">{d.assessment}</td></tr>))}</tbody></table>
            {trainEval.plan?.length > 0 && <><b className="small">Weekly plan</b><ul className="rules">{trainEval.plan.map((w: any, i: number) => <li key={i}>Week {w.week}: {w.deliverable}</li>)}</ul></>}
          </div>
        )}
      </div>

      <div className="profile-card">
        <h2>Deep-research prompt</h2>
        <p className="muted small">Generates a structured 6-axis research prompt personalized to your profile. Paste it into Claude/Perplexity/ChatGPT before an interview.</p>
        <div className="addform">
          <input placeholder="company" value={deepCompany} onChange={e => setDeepCompany(e.target.value)} />
          <input placeholder="role" value={deepRole} onChange={e => setDeepRole(e.target.value)} />
          <button className="primary" onClick={runDeep}>Generate</button>
        </div>
        {deepPrompt && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => copy(deepPrompt)}>Copy prompt</button>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', background: 'var(--panel2)', padding: 10, borderRadius: 8 }}>{deepPrompt}</pre>
          </div>
        )}
      </div>

      <div className="profile-card">
        <h2>Lateral &amp; cross-industry moves</h2>
        <button className="primary" onClick={loadMoves} disabled={!!busy}>{busy === 'moves' ? '…' : 'Suggest moves'}</button>
        <p className="muted small">Each move says which industries hire for it and the job titles to search for.</p>
        {moves && (
          <table className="jobs"><thead><tr><th>Role family</th><th>Industries</th><th>Titles to search</th><th>Pay</th><th>Remote</th><th>Why</th><th>Conf.</th></tr></thead>
            <tbody>{moves.map((m, i) => (
              <tr key={i}><td>{m.role_family}</td>
                <td className="muted small">{(m.industries?.length ? m.industries : [m.industry].filter(Boolean)).join(', ') || 'not given'}</td>
                <td className="muted small">{m.titles?.length ? m.titles.join(', ') : 'not given'}</td>
                <td>{pill(m.pay_outlook)}</td><td className="muted small">{m.remote_friendly ? 'yes' : 'no'}</td>
                <td className="muted small">{m.rationale}</td><td>{pill(m.confidence)}</td></tr>))}</tbody></table>)}
      </div>

      <div className="profile-card">
        <h2>Credential leg-up advisor</h2>
        <div className="addform">
          <input placeholder="target field / role (e.g. cloud solutions architect)" value={field} onChange={e => setField(e.target.value)} />
          <button className="primary" onClick={loadCerts} disabled={!!busy}>{busy === 'certs' ? '…' : 'Advise'}</button>
        </div>
        <p className="muted small">Every suggestion names the industries and job titles it makes you a stronger candidate for, and one of them is the promotion track: a step up rather than a sideways move.</p>
        {certs && (
          <table className="jobs"><thead><tr><th>Certificate</th><th>Makes you a candidate for</th><th>Lift</th><th>Effort</th><th>Why</th><th>Conf.</th></tr></thead>
            <tbody>{certs.map((c, i) => (
              <tr key={i}>
                <td>{c.certificate}{c.track === 'promotion' && <div><span className="pill pill-high">promotion track</span></div>}</td>
                <td className="muted small">
                  {c.titles?.length ? c.titles.join(', ') : 'no titles given'}
                  {c.industries?.length ? <div>in {c.industries.join(', ')}</div> : null}
                </td>
                <td>{pill(c.lift)}</td><td>{pill(c.effort)}</td>
                <td className="muted small">{c.rationale}</td><td>{pill(c.confidence)}</td></tr>))}</tbody></table>)}
      </div>

      <div className="profile-card">
        <h2>Company lookup</h2>
        <div className="addform">
          <input placeholder="company name" value={company} onChange={e => setCompany(e.target.value)} />
          <button className="primary" onClick={loadCompany} disabled={!!busy}>{busy === 'company' ? '…' : 'Look up'}</button>
        </div>
        {intel && !intel.error && (
          <div>
            <p><b>{intel.company}</b>: rating ~{intel.rating ?? '?'}/5 {pill(intel.confidence)} <span className="muted small">({intel.source})</span></p>
            <p className="muted small">{intel.summary}</p>
            <div className="proscons">
              <div><b className="sev-low">Pros</b><ul>{(intel.pros || []).map((p: string, i: number) => <li key={i}>{p}</li>)}</ul></div>
              <div><b className="sev-high">Cons</b><ul>{(intel.cons || []).map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></div>
            </div>
          </div>
        )}
      </div>
      <div className="profile-card">
        <h2>Company watch radar</h2>
        <p className="muted small">Get a desktop notification the moment a watched company posts a new role (checked on every scan).</p>
        <div className="addform">
          <input placeholder="company to watch" value={watchName} onChange={e => setWatchName(e.target.value)} />
          <button className="primary" onClick={addWatch}>Watch</button>
        </div>
        {watchLoading ? (
          <div className="loading-bar short" />
        ) : watch.length > 0 && (
          <ul className="rules">
            {watch.map(w => (
              <li key={w.id}>{w.label || w.normalized_name}
                <button className="link" aria-label={`Stop watching ${w.label || w.normalized_name}`} onClick={() => rmWatch(w.id, w.label || w.normalized_name)}>×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
