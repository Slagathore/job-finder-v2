import React, { useEffect, useState } from 'react';
import { confirmDialog, promptDialog, toast } from '../lib/feedback';
import type { ProjectProgress, ProjectRepo } from '../types';

const TOKEN_PAGE =
  'https://github.com/settings/tokens/new?scopes=repo,read:org&description=job-finder-v2';

type Status = Awaited<ReturnType<typeof window.api.projects.status>>;

function when(ts: number | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString();
}

function stateLabel(r: ProjectRepo): string {
  if (r.state === 'done') return `${r.depth === 'deep' ? 'deep dive' : 'read'}, ${r.items} items${r.digested_at ? `, ${when(r.digested_at)}` : ''}`;
  if (r.state === 'running') return 'in progress';
  if (r.state === 'error') return r.last_error ? `failed: ${r.last_error}` : 'failed';
  return 'not read yet';
}

/**
 * The Projects card: connect to GitHub without registering an OAuth App, scan
 * every repo into experience line items, and digest a local folder or a live
 * site the same way.
 */
export function ProjectsCard({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [busy, setBusy] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [picked, setPicked] = useState('');

  async function refresh() {
    try {
      setStatus(await window.api.projects.status());
      setRepos(await window.api.projects.list());
    } catch { /* the card just stays on its last known state */ }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => window.api.projects.onProgress(p => {
    setProgress(p);
    if (!p.running) { setBusy(''); refresh(); onChanged(); }
  }), []);

  async function installGh() {
    const ok = await confirmDialog({
      title: 'Install the GitHub CLI',
      message: 'This runs winget to install the GitHub CLI from Microsoft’s package source. It downloads and runs an installer, and Windows may ask you to approve it. Go ahead?',
      confirmLabel: 'Install it',
    });
    if (!ok) return;
    setBusy('Installing the GitHub CLI. This can take a couple of minutes.');
    const r = await window.api.projects.installGh();
    setBusy('');
    toast(r.message, r.ok ? 'success' : 'error');
    refresh();
  }

  async function saveToken() {
    if (!token.trim()) { toast('Paste the token first.', 'error'); return; }
    setBusy('Checking the token with GitHub.');
    const r = await window.api.projects.saveToken(token.trim());
    setBusy('');
    if ('error' in r) { toast(r.error, 'error'); return; }
    setToken(''); setShowToken(false);
    toast(`Token saved. GitHub says you are ${r.login}.`, 'success');
    refresh();
  }

  async function forgetToken() {
    const ok = await confirmDialog({
      title: 'Forget the saved token',
      message: 'Delete the saved GitHub token from this app?',
      confirmLabel: 'Forget it', danger: true,
    });
    if (!ok) return;
    await window.api.projects.clearToken();
    toast('Token deleted.', 'success');
    refresh();
  }

  async function findRepos() {
    setBusy('Asking GitHub for your repos.');
    const r = await window.api.projects.refresh();
    setBusy('');
    if ('error' in r) { toast(r.error, 'error'); return r; }
    toast(`Found ${r.total} repos, ${r.privateCount} of them private.`, 'success');
    refresh();
    return r;
  }

  async function scanRepos() {
    const found = await findRepos();
    if ('error' in found) return;
    const r = await window.api.projects.scan('medium');
    if ('error' in r) { toast(r.error, 'error'); return; }
    setBusy('Reading your repos.');
    setProgress({ running: true, phase: 'Starting', current: '', done: 0, total: 0, percent: 0 });
  }

  async function deepDive() {
    if (!picked) { toast('Pick a repo from the list first.', 'error'); return; }
    setBusy(`Deep diving ${picked}. This reads the actual source, so it takes a while.`);
    setProgress({ running: true, phase: 'Starting', current: picked, done: 0, total: 1, percent: 5 });
    const r = await window.api.projects.deepDive(picked);
    setBusy(''); setProgress(null);
    if ('error' in r) { toast(r.error, 'error'); refresh(); return; }
    toast(`${picked}: ${r.added} new line items, ${r.merged} merged into what you already had.`, 'success');
    refresh(); onChanged();
  }

  async function digestFolder() {
    const dir = await window.api.app.pickPath({ properties: ['openDirectory'] });
    if (!dir) return;
    setBusy('Reading that folder.');
    setProgress({ running: true, phase: 'Starting', current: dir, done: 0, total: 1, percent: 5 });
    const r = await window.api.projects.digestFolder(dir);
    setBusy(''); setProgress(null);
    if ('error' in r) { toast(r.error, 'error'); return; }
    toast(`${r.source}: ${r.added} new line items, ${r.merged} merged.`, 'success');
    onChanged();
  }

  async function digestUrl() {
    const url = await promptDialog({
      title: 'Digest a web app',
      message: 'Paste the address of something you built and shipped.',
      placeholder: 'https://example.com',
    });
    if (!url?.trim()) return;
    setBusy('Reading that page.');
    setProgress({ running: true, phase: 'Starting', current: url, done: 0, total: 1, percent: 5 });
    const r = await window.api.projects.digestUrl(url.trim());
    setBusy(''); setProgress(null);
    if ('error' in r) { toast(r.error, 'error'); return; }
    toast(`${r.added} new line items, ${r.merged} merged.`, 'success');
    onChanged();
  }

  const connected = !!status?.connected;
  const running = !!progress?.running || !!busy;

  return (
    <div className="profile-card" style={{ marginTop: 12 }}>
      <h2>Projects</h2>
      <p className="muted small">
        Point this at your GitHub, a folder on disk, or something you have deployed, and it turns
        what you actually built into line items the rest of the app can talk about.
      </p>

      {/* ── Connection ────────────────────────────────────────────────── */}
      {!status ? (
        <div className="loading-bar medium" />
      ) : connected ? (
        <p className="small">
          Connected as <b>{status.login || 'your GitHub account'}</b>{' '}
          {status.source === 'gh' ? 'through the GitHub CLI' : 'with a saved token'}.
          {status.missingScopes.length > 0 && status.source === 'gh' && (
            <span className="muted"> Missing scope: {status.missingScopes.join(', ')}, so private repos may not show up.</span>
          )}
          {status.tokenSaved && <button className="link" onClick={forgetToken}>forget saved token</button>}
        </p>
      ) : (
        <div className="small">
          <p>{status.ghDetail}</p>
          <div className="row">
            {!status.ghInstalled && (
              <button className="primary" onClick={installGh} disabled={running}>Install the GitHub CLI</button>
            )}
            <button onClick={refresh} disabled={running}>Retry</button>
            <button className="link" onClick={() => setShowToken(v => !v)}>
              {showToken ? 'hide the token option' : 'use a token instead'}
            </button>
          </div>
          {status.ghInstalled && !status.ghAuthenticated && (
            <p className="muted">Open a terminal, run <code>gh auth login</code>, then hit Retry.</p>
          )}
        </div>
      )}

      {(showToken || (status && !connected && !status.ghInstalled)) && (
        <div className="addform" style={{ marginTop: 6 }}>
          <button onClick={() => window.api.app.openExternal(TOKEN_PAGE)}>Open the token page</button>
          <input
            type="password" placeholder="paste the token here" value={token}
            onChange={e => setToken(e.target.value)} autoComplete="off"
          />
          <button className="primary" onClick={saveToken} disabled={running || !token.trim()}>Save token</button>
        </div>
      )}
      {showToken && (
        <p className="muted small">
          The token page is preloaded with the scopes this needs. The token is stored encrypted on
          this machine and only ever sent to GitHub.
        </p>
      )}

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" onClick={scanRepos} disabled={!connected || running}>Scan my repos</button>
        <button onClick={digestFolder} disabled={running}>Digest a local folder</button>
        <button onClick={digestUrl} disabled={running}>Digest a web app URL</button>
        {status && status.counts.total > 0 && (
          <span className="muted small">
            {status.counts.done} read, {status.counts.pending} to go
            {status.counts.error ? `, ${status.counts.error} failed` : ''}
          </span>
        )}
      </div>

      {progress && (
        <div className="proj-progress">
          <div className="proj-bar"><div className="proj-bar-fill" style={{ width: `${progress.percent}%` }} /></div>
          <div className="muted small">
            {progress.percent}% {progress.phase}
            {progress.current ? ` · ${progress.current}` : ''}
            {progress.total > 1 ? ` · ${progress.done} of ${progress.total}` : ''}
          </div>
        </div>
      )}
      {busy && !progress && <p className="muted small">{busy}</p>}

      {/* ── Deep dive one repo ────────────────────────────────────────── */}
      {repos.length > 0 && (
        <>
          <div className="addform" style={{ marginTop: 10 }}>
            <select value={picked} onChange={e => setPicked(e.target.value)} aria-label="Repo to deep dive">
              <option value="">pick a repo…</option>
              {repos.map(r => (
                <option key={r.id} value={r.full_name}>
                  {r.full_name}{r.private ? ' (private)' : ''}{r.depth === 'deep' ? ' [deep]' : ''}
                </option>
              ))}
            </select>
            <button className="primary" onClick={deepDive} disabled={!connected || running || !picked}>
              Deep dive this repo
            </button>
          </div>
          <p className="muted small">
            A scan reads the readme and the manifest. A deep dive reads the source too, which is
            where the work worth talking about usually is.
          </p>

          <table className="jobs">
            <thead><tr><th>Repo</th><th>Language</th><th>State</th></tr></thead>
            <tbody>
              {repos.map(r => (
                <tr key={r.id}>
                  <td>
                    {r.html_url
                      ? <button className="link" onClick={() => window.api.app.openExternal(r.html_url!)}>{r.full_name}</button>
                      : r.full_name}
                    {r.private ? <span className="chip">private</span> : null}
                  </td>
                  <td className="muted small">{r.language || '—'}</td>
                  <td className="muted small">{stateLabel(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
