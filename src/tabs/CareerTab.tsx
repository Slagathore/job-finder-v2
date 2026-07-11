import React, { useEffect, useState } from 'react';
import { confirmDialog, toast } from '../lib/feedback';

const pill = (v: string) => <span className={`pill pill-${v}`}>{v}</span>;

export function CareerTab() {
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

      <div className="profile-card">
        <h2>Lateral &amp; cross-industry moves</h2>
        <button className="primary" onClick={loadMoves} disabled={!!busy}>{busy === 'moves' ? '…' : 'Suggest moves'}</button>
        {moves && (
          <table className="jobs"><thead><tr><th>Role family</th><th>Industry</th><th>Pay</th><th>Remote</th><th>Why</th><th>Conf.</th></tr></thead>
            <tbody>{moves.map((m, i) => (
              <tr key={i}><td>{m.role_family}</td><td className="muted small">{m.industry || '—'}</td>
                <td>{pill(m.pay_outlook)}</td><td className="muted small">{m.remote_friendly ? 'yes' : 'no'}</td>
                <td className="muted small">{m.rationale}</td><td>{pill(m.confidence)}</td></tr>))}</tbody></table>)}
      </div>

      <div className="profile-card">
        <h2>Credential leg-up advisor</h2>
        <div className="addform">
          <input placeholder="target field / role (e.g. cloud solutions architect)" value={field} onChange={e => setField(e.target.value)} />
          <button className="primary" onClick={loadCerts} disabled={!!busy}>{busy === 'certs' ? '…' : 'Advise'}</button>
        </div>
        {certs && (
          <table className="jobs"><thead><tr><th>Certificate</th><th>Lift</th><th>Effort</th><th>Why</th><th>Conf.</th></tr></thead>
            <tbody>{certs.map((c, i) => (
              <tr key={i}><td>{c.certificate}</td><td>{pill(c.lift)}</td><td>{pill(c.effort)}</td>
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
            <p><b>{intel.company}</b> — rating ~{intel.rating ?? '?'}/5 {pill(intel.confidence)} <span className="muted small">({intel.source})</span></p>
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
