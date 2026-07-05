import React, { useEffect, useState } from 'react';

export function SelfExtendTab() {
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<any>(null);
  const [sandbox, setSandbox] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [list, setList] = useState<any[]>([]);

  async function refresh() { setList(await window.api.selfext.list()); }
  useEffect(() => { refresh(); }, []);

  async function propose() {
    if (!instruction.trim()) return;
    setBusy('Generating patch (LLM)…'); setMsg(''); setProposal(null); setSandbox(null);
    const r = await window.api.selfext.propose(instruction.trim());
    setBusy('');
    if ('error' in r) { setMsg(`⚠️ ${r.error}`); return; }
    setProposal(r); refresh();
  }
  async function runSandbox() {
    setBusy('Sandboxing: clone → lint → test (can take a minute)…'); setMsg('');
    const r = await window.api.selfext.sandbox(proposal.id);
    setBusy('');
    if ('error' in r) { setMsg(`⚠️ ${r.error}`); return; }
    setSandbox(r); refresh();
  }
  async function approve() {
    if (!confirm('Apply this patch to the live app code? You can roll back afterward.')) return;
    setBusy('Applying + backing up…');
    const r = await window.api.selfext.approve(proposal.id);
    setBusy('');
    setMsg('error' in r && r.error ? `⚠️ ${r.error}` : `Applied. Changed: ${(r.changed || []).join(', ')}. Rebuild/restart the app (npm run build) to load it.`);
    setProposal(null); setSandbox(null); refresh();
  }
  async function reject() { await window.api.selfext.reject(proposal.id); setProposal(null); setSandbox(null); refresh(); }
  async function rollback(id: number) {
    if (!confirm('Roll back this applied patch?')) return;
    const r = await window.api.selfext.rollback(id);
    setMsg('error' in r && r.error ? `⚠️ ${r.error}` : 'Rolled back. Rebuild/restart to revert.');
    refresh();
  }

  const sev = proposal?.scan?.counts || { high: 0, medium: 0, low: 0 };

  return (
    <div className="panel" style={{ maxWidth: 940 }}>
      <h1>Self-extend</h1>
      <p className="muted small">
        Describe a feature; the agent writes the code, it’s scanned + sandbox-tested (lint + tests on an
        isolated copy), and <b>nothing touches the live app until you approve</b>. Every applied patch is backed up &amp; reversible.
      </p>

      <textarea rows={3} placeholder="e.g. Add a CSV export button to the Search results" value={instruction} onChange={e => setInstruction(e.target.value)} />
      <div className="row">
        <button className="primary" onClick={propose} disabled={!!busy}>Propose patch</button>
        {busy && <span className="muted small">{busy}</span>}
        {msg && <span className="muted small">{msg}</span>}
      </div>

      {proposal && (
        <div className="profile-card">
          <h2>Proposed patch</h2>
          <p>{proposal.patch.rationale}</p>
          <p className="muted small">Files: {proposal.patch.files.map((f: any) => `${f.path} (${f.mode})`).join(', ')}</p>
          <p className="muted small">Scan: <b className={sev.high ? 'sev-high' : ''}>{sev.high} high</b> · {sev.medium} med · {sev.low} low (advisory)</p>
          {proposal.scan?.findings?.length > 0 && (
            <ul className="findings">
              {proposal.scan.findings.slice(0, 12).map((f: any, i: number) => (
                <li key={i}><span className={`sev-${f.severity}`}>{f.severity}</span> {f.rule} — {f.file}:{f.line} <code>{f.snippet}</code></li>
              ))}
            </ul>
          )}
          <details><summary className="muted small">view file contents</summary>
            {proposal.patch.files.map((f: any, i: number) => (
              <div key={i}><div className="muted small">{f.path} ({f.mode})</div>
                {f.contents && <pre className="out" style={{ maxHeight: 240, overflow: 'auto' }}>{f.contents}</pre>}</div>
            ))}
          </details>
          <div className="row">
            <button className="primary" onClick={runSandbox} disabled={!!busy}>Sandbox test</button>
            <button className="primary" onClick={approve} disabled={!!busy || !sandbox?.ok}>Approve &amp; apply</button>
            <button className="link" onClick={reject}>reject</button>
          </div>
          {sandbox && (
            <div className={`res ${sandbox.ok ? '' : 'bad'}`}>
              {sandbox.ok ? '✓ sandbox passed' : `✗ failed at ${sandbox.stage}`} ({Math.round(sandbox.durationMs / 1000)}s)
              {!sandbox.ok && <pre className="out" style={{ maxHeight: 220, overflow: 'auto' }}>{sandbox.output}</pre>}
            </div>
          )}
          {!sandbox?.ok && <p className="muted small">Approve is enabled only after the sandbox passes.</p>}
        </div>
      )}

      <h2>History</h2>
      <table className="jobs">
        <thead><tr><th>#</th><th>Rationale</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.map(p => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.rationale}</td>
              <td className="muted small">{p.status}</td>
              <td>{p.status === 'applied' && <button className="link" onClick={() => rollback(p.id)}>rollback</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
