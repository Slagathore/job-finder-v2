import React, { useEffect, useState } from 'react';
import { confirmDialog, toast } from '../lib/feedback';

const FIELDS: { key: string; label: string; type?: string; hint?: string }[] = [
  { key: 'candidateName', label: 'Your name', hint: 'Used on generated resumes / cover letters' },
  { key: 'candidateEmail', label: 'Your email' },
  { key: 'candidatePhone', label: 'Your phone' },
  { key: 'candidateLocation', label: 'Your location' },
  { key: 'candidateLinks', label: 'Your links', hint: 'e.g. github.com/you, linkedin.com/in/you' },
  { key: 'ollamaBaseUrl', label: 'Ollama base URL', hint: 'Native API — chat, health, embeddings, local models' },
  { key: 'primaryModel', label: 'Primary model', hint: 'Default: kimi-k2.7-code:cloud' },
  { key: 'fallbackLocalModel', label: 'Local fallback model', hint: 'Used if cloud + Anthropic both fail' },
  { key: 'anthropicApiKey', label: 'Anthropic API key', type: 'password', hint: 'Optional — enables Anthropic fallback' },
  { key: 'anthropicModel', label: 'Anthropic model' },
  { key: 'embeddingModel', label: 'Embedding model', hint: 'Local, via Ollama (phase 4 semantic search)' },
  { key: 'scanIntervalMinutes', label: 'Scan interval (min)', type: 'number', hint: '0 = off (also paces mail ingest)' },
  { key: 'gmailClientId', label: 'Gmail OAuth client ID', hint: 'From your Google Cloud OAuth (Desktop) client' },
  { key: 'gmailClientSecret', label: 'Gmail OAuth client secret', type: 'password' },
  { key: 'pruneAfterDays', label: 'Auto-prune after (days)', type: 'number', hint: 'Remove UNTOUCHED discovered jobs older than this; 0 = off. Starred/graded/applied are never pruned.' },
];

export function SettingsTab() {
  const [s, setS] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);
  const [hub, setHub] = useState<{ url: string; token: string } | null>(null);
  const [blocklist, setBlocklist] = useState<any[]>([]);
  const [blockName, setBlockName] = useState('');
  const [gmail, setGmail] = useState<{ connected: boolean; email: string } | null>(null);
  const [mailMsg, setMailMsg] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [pruneMsg, setPruneMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [doctor, setDoctor] = useState<{ name: string; ok: boolean; detail: string }[]>([]);
  const [doctorBusy, setDoctorBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      window.api.settings.get().then(setS),
      window.api.app.hubInfo().then(h => setHub({ url: h.url, token: h.token })),
      window.api.blocklist.list().then(setBlocklist),
      window.api.gmail.status().then(setGmail),
      window.api.maintenance.stats().then(setStats),
    ]).finally(() => setLoading(false));
  }, []);

  async function pruneNow() {
    setPruneMsg('Pruning…');
    const r = await window.api.maintenance.prune();
    setPruneMsg('');
    toast(`Removed ${r.jobsDeleted} untouched jobs + ${r.notificationsDeleted} old notifications.`, 'success');
    setStats(await window.api.maintenance.stats());
  }

  async function connectGmail() {
    await save();
    const r = await window.api.gmail.authUrl();
    if ('error' in r) { setMailMsg(`⚠️ ${r.error}`); return; }
    window.api.app.openExternal(r.url);
    setMailMsg('Approve in your browser, then click “Refresh status”.');
  }
  async function refreshGmail() { setGmail(await window.api.gmail.status()); }
  async function checkMail() {
    setMailMsg('Checking…');
    const r = await window.api.gmail.ingest();
    setMailMsg(r.error ? `⚠️ ${r.error}` : `Processed ${r.processed}, matched ${r.matched}, advanced ${r.advanced}.`);
  }
  async function disconnectGmail() { await window.api.gmail.disconnect(); setGmail(await window.api.gmail.status()); setMailMsg(''); }

  async function rotateToken() {
    const ok = await confirmDialog({ title: 'Rotate pairing token', message: 'Generate a new hub token? The extension stops working until you paste the new token into its popup.', confirmLabel: 'Rotate', danger: true });
    if (!ok) return;
    const token = await window.api.app.rotateHubToken();
    setHub(h => h ? { ...h, token } : h);
    toast('Token rotated — update the extension popup.', 'success');
  }

  async function addBlock() {
    if (!blockName.trim()) return;
    await window.api.blocklist.add(blockName.trim());
    setBlockName(''); setBlocklist(await window.api.blocklist.list());
  }
  async function removeBlock(id: number, blockedName: string) {
    const ok = await confirmDialog({ title: 'Remove from blocklist', message: `Remove "${blockedName}" from the blocklist? Jobs from this company become applyable again.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await window.api.blocklist.remove(id); setBlocklist(await window.api.blocklist.list());
  }

  function update(key: string, value: any) { setS(prev => ({ ...prev, [key]: value })); setSaved(false); }

  async function save() {
    const patch: Record<string, any> = {};
    for (const f of FIELDS) {
      patch[f.key] = f.type === 'number' ? Number(s[f.key]) || 0 : s[f.key];
    }
    const r: any = await window.api.settings.set(patch);
    // Secrets are refused (never stored in cleartext) when no OS keychain exists.
    if (r && r.error) { toast(r.error, 'error'); setSaved(false); return; }
    await window.api.app.rearmScheduler();
    setSaved(true);
  }

  return (
    <div className="panel">
      <h1>Settings</h1>

      {hub && (
        <div className="profile-card" style={{ marginBottom: 18 }}>
          <h2>Browser extension pairing</h2>
          <p className="muted small">Load the extension (Developer Mode → Load unpacked → <code>job_finder_v2/extension</code>), open its popup, and paste these.</p>
          <div className="field"><span className="field-l">Hub URL</span>
            <input readOnly value={hub.url} onFocus={e => e.currentTarget.select()} /></div>
          <div className="field" style={{ marginTop: 8 }}><span className="field-l">Pairing token</span>
            <input readOnly value={hub.token} onFocus={e => e.currentTarget.select()} /></div>
          <div className="row">
            <button className="link" onClick={rotateToken}>rotate token</button>
            <span className="muted small">Invalidates the old pairing immediately — paste the new token into the extension popup.</span>
          </div>
        </div>
      )}

      {loading ? (
        <>
          <div className="loading-bar long" />
          <div className="loading-bar medium" />
          <div className="loading-bar long" />
        </>
      ) : (
        <div className="form">
          {FIELDS.map(f => (
            <label key={f.key} className="field">
              <span className="field-l">{f.label}</span>
              <input
                type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                value={s[f.key] ?? ''}
                onChange={e => update(f.key, e.target.value)}
              />
              {f.hint && <span className="field-h">{f.hint}</span>}
            </label>
          ))}
        </div>
      )}
      <div className="row">
        <button className="primary" onClick={save} disabled={loading}>Save</button>
        {saved && <span className="msg-success">Saved ✓</span>}
      </div>

      <div className="profile-card" style={{ marginTop: 18 }}>
        <h2>Thinking</h2>
        <label className="field">
          <span className="field-l">Thinking effort</span>
          <select
            value={s.think === true ? 'on' : s.think || 'off'}
            onChange={async e => {
              const v = e.target.value;
              const think = v === 'off' ? false : v === 'on' ? true : v;
              setS(p => ({ ...p, think }));
              await window.api.settings.set({ think });
            }}>
            <option value="off">off</option>
            <option value="on">on</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
          <span className="field-h">Reasoning pass for the primary model (kimi-k2.7-code supports it). Off by default.</span>
        </label>
        <label className="modechk">
          <input type="checkbox" checked={!!s.showThinking}
            onChange={async e => { const v = e.target.checked; setS(p => ({ ...p, showThinking: v })); await window.api.settings.set({ showThinking: v }); }} />
          Surface the model&apos;s thinking alongside answers (it is never mixed into the answer text)
        </label>
      </div>

      <div className="profile-card" style={{ marginTop: 18 }}>
        <h2>Applying</h2>
        <label className="modechk">
          <input type="checkbox" checked={!!s.autoSubmitWhenComplete}
            onChange={async e => { const v = e.target.checked; setS(p => ({ ...p, autoSubmitWhenComplete: v })); await window.api.settings.set({ autoSubmitWhenComplete: v }); }} />
          Auto-submit when the form is 100% complete (clicks Submit only if no required field is empty)
        </label>
        <p className="muted small">Off by default. Personality/aptitude assessments are detected and left for you — never auto-answered.</p>
      </div>

      {gmail && (
        <div className="profile-card" style={{ marginTop: 18 }}>
          <h2>Mailbox (Gmail)</h2>
          <p className="muted small">Ingests replies → classifies (ack / rejection / interview / offer / recruiter) → advances the pipeline. Needs a Google Cloud OAuth <i>Desktop</i> client (ID/secret above) with redirect <code>{hub?.url}/oauth/callback</code>.</p>
          <p className="small">Status: {gmail.connected ? <b>connected{gmail.email ? ` (${gmail.email})` : ''}</b> : 'not connected'}</p>
          <div className="row">
            {!gmail.connected
              ? <button className="primary" onClick={connectGmail}>Connect Gmail</button>
              : <button className="primary" onClick={checkMail}>Check mail now</button>}
            <button className="link" onClick={refreshGmail}>refresh status</button>
            {gmail.connected && <button className="link" onClick={disconnectGmail}>disconnect</button>}
            {mailMsg && <span className={mailMsg.startsWith('⚠️') ? 'msg-error' : 'msg-success'}>{mailMsg}</span>}
          </div>
        </div>
      )}

      {stats && (
        <div className="profile-card" style={{ marginTop: 18 }}>
          <h2>Maintenance</h2>
          <p className="muted small">{stats.jobs} jobs · {stats.applications} applications · {stats.starred} starred · {stats.prunable} prunable now.</p>
          <p className="muted small">Prune only removes <b>untouched</b> discovered jobs older than the cutoff above. Anything starred, graded, salary-checked, surfaced, or applied to is never auto-removed — remove those manually.</p>
          <div className="row">
            <button className="primary" onClick={pruneNow}>Prune now</button>
            {pruneMsg && <span className="muted small">{pruneMsg}</span>}
          </div>
        </div>
      )}

      <div className="profile-card" style={{ marginTop: 18 }}>
        <h2>Diagnostics</h2>
        <p className="muted small">One-click health check of every subsystem — run this when something seems off.</p>
        <button className="primary" onClick={async () => { setDoctor([]); setDoctorBusy(true); try { setDoctor(await window.api.career.doctor()); } finally { setDoctorBusy(false); } }} disabled={doctorBusy}>
          {doctorBusy ? 'Checking…' : 'Run diagnostics'}
        </button>
        {doctor.length > 0 && (
          <ul className="rules" style={{ marginTop: 8 }}>
            {doctor.map((c, i) => (
              <li key={i}>{c.ok ? '✅' : '❌'} <b>{c.name}</b> <span className="muted small">— {c.detail}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="profile-card" style={{ marginTop: 18 }}>
        <h2>Updates</h2>
        <p className="muted small">
          On launch the app checks GitHub for a newer version.{' '}
          {s.updateSilence === 'forever' ? 'Notifications are currently silenced forever.'
            : s.updateSilence ? 'Notifications are silenced until the next update is pushed.'
            : 'Notifications are on.'}
          {' '}Critical (emergency) updates always notify regardless.
        </p>
        {!!s.updateSilence && (
          <button className="primary" onClick={async () => {
            await window.api.update.silence('clear');
            setS(p => ({ ...p, updateSilence: '' }));
          }}>Re-enable update notifications</button>
        )}
      </div>

      <div className="profile-card" style={{ marginTop: 18 }}>
        <h2>Company blocklist</h2>
        <p className="muted small">The hard apply gate — these companies are never applied to (matching is normalized).</p>
        <div className="addform">
          <input placeholder="company name" value={blockName} onChange={e => setBlockName(e.target.value)} />
          <button className="primary" onClick={addBlock}>Block</button>
        </div>
        {loading ? (
          <div className="loading-bar short" />
        ) : blocklist.length > 0 && (
          <ul className="rules">
            {blocklist.map(b => <li key={b.id}>{b.normalized_name} <span className="muted small">({b.reason})</span>
              <button className="link" aria-label={`Remove ${b.normalized_name} from blocklist`} onClick={() => removeBlock(b.id, b.normalized_name)}>×</button></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
