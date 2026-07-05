import React, { useEffect, useState } from 'react';
import type { ScanSummary } from '../types';

export function Dashboard() {
  const [total, setTotal] = useState<number | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [followups, setFollowups] = useState<any[]>([]);
  const [gs, setGs] = useState<{ llm: boolean; contact: boolean; jobs: boolean; experience: boolean; embedded: boolean; extension: boolean } | null>(null);
  const [digest, setDigest] = useState<any>(null);
  const [heat, setHeat] = useState<{ grid: { date: string; count: number }[]; streak: number; total: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [scanErr, setScanErr] = useState('');

  // LLM smoke test state
  const [prompt, setPrompt] = useState('In one sentence, say hello and name the model answering.');
  const [out, setOut] = useState('');
  const [meta, setMeta] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const c = await window.api.jobs.counts();
    setTotal(c.total);
    const jl = await window.api.jobs.list({ limit: 50 });
    setJobs(jl);
    setFollowups(await window.api.followups.list());
    const [health, settings, items, prof] = await Promise.all([
      window.api.llm.health(), window.api.settings.get(),
      window.api.experience.list(), window.api.experience.getProfile(),
    ]);
    setGs({
      llm: health.ollamaUp || health.anthropicConfigured,
      contact: !!(settings.candidateName && settings.candidateEmail),
      jobs: c.total > 0,
      experience: (items?.length ?? 0) > 0,
      embedded: !!(prof?.profile || (prof?.roleFits?.length)),
      extension: jl.some((j: any) => /ext/.test(j.source || '')),
    });
    setDigest(await window.api.digest.get());
    setHeat(await window.api.activity.heatmap(16));
  }
  function heatColor(n: number): string {
    if (n <= 0) return 'var(--panel2)';
    if (n === 1) return '#1e3a5f'; if (n <= 3) return '#2f6fb0'; if (n <= 5) return '#4c9be0';
    return '#5b8cff';
  }
  useEffect(() => { refresh(); }, []);

  async function scan() {
    setScanning(true); setScanErr(''); setSummary(null);
    try {
      const r = await window.api.scan.run('manual');
      if ('error' in r) setScanErr(r.error);
      else setSummary(r);
      await refresh();
    } finally { setScanning(false); }
  }

  async function runLlm() {
    setBusy(true); setOut(''); setMeta('');
    try {
      const r = await window.api.llm.generate([{ role: 'user', content: prompt }], { maxTokens: 300 });
      if ('error' in r) setOut(`⚠️ ${r.error}`);
      else { setOut(r.text); setMeta(`${r.provider} · ${r.model}${r.usedFallback ? ' · (fallback)' : ''}`); }
    } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <h1>Dashboard</h1>

      {gs && !(gs.llm && gs.contact && gs.jobs && gs.experience && gs.embedded) && (
        <div className="profile-card" style={{ marginBottom: 14 }}>
          <h2>Getting started</h2>
          <ul className="checklist">
            <li className={gs.llm ? 'done' : ''}>{gs.llm ? '✓' : '○'} Start Ollama (or set an Anthropic key in Settings) — needed for AI features</li>
            <li className={gs.contact ? 'done' : ''}>{gs.contact ? '✓' : '○'} Settings → add your name + email (used on tailored resumes)</li>
            <li className={gs.jobs ? 'done' : ''}>{gs.jobs ? '✓' : '○'} Scan ATS boards (button below) — fills the job database</li>
            <li className={gs.experience ? 'done' : ''}>{gs.experience ? '✓' : '○'} Experience tab → import a résumé, then “Analyze”</li>
            <li className={gs.embedded ? 'done' : ''}>{gs.embedded ? '✓' : '○'} Search tab → “Embed” then “Discover” your best-fit jobs</li>
            <li className={gs.extension ? 'done' : ''}>{gs.extension ? '✓' : '○'} (optional) Load the browser extension to harvest Indeed/LinkedIn/Glassdoor — see <b>Settings → Browser extension pairing</b></li>
          </ul>
        </div>
      )}

      {digest && (
        <div className="digest">
          <div className="dstat"><div className="dn">{digest.newToday}</div><div className="dl">new today</div></div>
          <div className="dstat"><div className="dn">{digest.surfaced}</div><div className="dl">surfaced fits</div></div>
          <div className="dstat"><div className="dn">{digest.followupsDue}</div><div className="dl">follow-ups due</div></div>
          <div className="dstat"><div className="dn">{digest.interviewsOffers}</div><div className="dl">interviews/offers</div></div>
          <div className="dstat"><div className="dn">{digest.starred}</div><div className="dl">starred</div></div>
        </div>
      )}

      {heat && (
        <div className="profile-card" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
            <h2 style={{ margin: 0 }}>Application activity</h2>
            <span className="muted small">{heat.total} total · {heat.streak}-day streak{heat.streak >= 3 ? ' 🔥' : ''}</span>
          </div>
          <div className="heatmap">
            {heat.grid.map((d, i) => <div key={i} className="hcell" title={`${d.date}: ${d.count}`} style={{ background: heatColor(d.count) }} />)}
          </div>
        </div>
      )}

      <div className="cards">
        <div className="card">
          <div className="card-n">{total ?? '—'}</div>
          <div className="card-l">jobs in database</div>
        </div>
        <div className="card">
          <button className="primary" onClick={scan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan ATS boards now'}
          </button>
          <div className="card-l" style={{ marginTop: 8 }}>Greenhouse · Ashby · Lever (zero-cost APIs)</div>
        </div>
      </div>

      {scanErr && <pre className="out">⚠️ {scanErr}</pre>}
      {summary && (
        <p className="muted small">
          Scanned {summary.scanned} boards · {summary.found} found · {summary.added} new ·{' '}
          {summary.duplicates} dupes · {summary.filteredTitle} filtered
          {summary.errors.length > 0 && ` · ${summary.errors.length} errors`}
        </p>
      )}

      {followups.length > 0 && (
        <div className="profile-card" style={{ marginBottom: 14 }}>
          <h2>Follow-ups due ({followups.length})</h2>
          <table className="jobs"><tbody>
            {followups.slice(0, 8).map(f => (
              <tr key={f.appId}>
                <td><a href={f.url} target="_blank" rel="noreferrer">{f.title}</a> <span className="muted small">— {f.company}</span></td>
                <td className="muted small">{f.state} · {f.daysSince}d</td>
                <td className="muted small">{f.action}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      <h2>Recent jobs</h2>
      {jobs.length === 0 ? (
        <p className="muted">No jobs yet — hit “Scan ATS boards now”.</p>
      ) : (
        <table className="jobs">
          <thead><tr><th>Company</th><th>Title</th><th>Location</th><th>Mode</th><th>Source</th></tr></thead>
          <tbody>
            {jobs.map(j => (
              <tr key={j.id}>
                <td>{j.company}</td>
                <td><a href={j.url} target="_blank" rel="noreferrer">{j.title}</a></td>
                <td>{j.location_raw || '—'}</td>
                <td>{j.work_mode || '—'}</td>
                <td className="muted small">{j.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>LLM smoke test</h2>
      <p className="muted small">Verifies the provider chain (Ollama Cloud /v1 → Anthropic → local).</p>
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} />
      <div className="row">
        <button className="primary" onClick={runLlm} disabled={busy}>{busy ? 'Running…' : 'Run'}</button>
        {meta && <span className="muted small">{meta}</span>}
      </div>
      {out && <pre className="out">{out}</pre>}
    </div>
  );
}
