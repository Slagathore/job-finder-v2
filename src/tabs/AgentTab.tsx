import React, { useEffect, useRef, useState } from 'react';

interface Msg { role: 'user' | 'assistant'; content: string; plan?: { summary: string; steps: any[] }; results?: any[]; }

export function AgentTab({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [perms, setPerms] = useState<{ capability: string; mode: string }[]>([]);
  const [permsLoading, setPermsLoading] = useState(true);
  const [showPerms, setShowPerms] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { window.api.agent.permissions().then(p => { setPerms(p); setPermsLoading(false); }); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  function history() {
    return msgs.slice(-6).map(m => ({ role: m.role, content: m.content }));
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput(''); setBusy(true);
    setMsgs(m => [...m, { role: 'user', content: message }]);
    const r = await window.api.agent.plan(message, history());
    if (r.intent === 'explanation') {
      setMsgs(m => [...m, { role: 'assistant', content: r.explanation || '(no answer)' }]);
    } else if (r.intent === 'valid' && r.plan) {
      setMsgs(m => [...m, { role: 'assistant', content: r.plan!.summary || 'Here is a plan:', plan: r.plan }]);
    } else {
      setMsgs(m => [...m, { role: 'assistant', content: `⚠️ ${r.error || 'Could not form a plan.'}` }]);
    }
    setBusy(false);
  }

  async function runPlan(idx: number, steps: any[]) {
    setBusy(true);
    const r = await window.api.agent.run(steps);
    setMsgs(m => m.map((msg, i) => i === idx ? { ...msg, results: r.results } : msg));
    const openTabStep = [...r.results].reverse().find(s => s.openTab);
    if (openTabStep?.openTab) onOpenTab(openTabStep.openTab);
    setBusy(false);
  }

  async function setMode(capability: string, mode: string) {
    setPerms(await window.api.agent.setPermission(capability, mode));
  }
  async function confirmStep(mi: number, ri: number, res: any) {
    const out = await window.api.agent.runStep({ tool: res.tool, args: res.args });
    setMsgs(ms => ms.map((m, i) => i !== mi ? m : { ...m, results: m.results!.map((r, k) => k === ri ? out : r) }));
    if ((out as any).openTab) onOpenTab((out as any).openTab);
  }

  return (
    <div className="panel agent" style={{ maxWidth: 880 }}>
      <div className="agent-head">
        <h1>Agent</h1>
        <button className="link" onClick={() => setShowPerms(s => !s)}>{showPerms ? 'hide' : 'permissions'}</button>
      </div>

      {showPerms && (
        <div className="profile-card">
          <h2>Capability permissions</h2>
          <p className="muted small">Default: everything auto except <b>apply</b> (off) and <b>self_extension</b> (confirm).</p>
          {permsLoading && <div className="loading-bar medium" />}
          <div className="perms">
            {perms.map(p => (
              <label key={p.capability} className="perm">
                <span>{p.capability}</span>
                <select value={p.mode} onChange={e => setMode(p.capability, e.target.value)}>
                  <option value="auto">auto</option><option value="confirm">confirm</option><option value="off">off</option>
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="chat">
        {msgs.length === 0 && <p className="muted">Ask me to do anything — e.g. “scan all boards then discover my best fits”, “tailor a resume for job 12”, “add a rule: never apply to staffing agencies”.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <div>{m.content}</div>
            {m.plan && (
              <div className="plan">
                <ol>{m.plan.steps.map((s, j) => <li key={j}><b>{s.tool}</b> {s.reason ? `— ${s.reason}` : ''} <code>{JSON.stringify(s.args)}</code></li>)}</ol>
                {!m.results && <button className="primary" onClick={() => runPlan(i, m.plan!.steps)} disabled={busy}>Run plan</button>}
              </div>
            )}
            {m.results && (
              <div className="results">
                {m.results.map((res: any, j: number) => (
                  <div key={j} className={`res ${res.ok ? '' : res.needsConfirm ? '' : 'bad'}`}>
                    {res.needsConfirm ? '⏸' : res.ok ? '✓' : '✗'} <b>{res.tool}</b>: {res.summary || res.error}
                    {res.needsConfirm && <> <button className="link" onClick={() => confirmStep(i, j, res)}>confirm &amp; run</button></>}
                    {res.data?.cv && <> · <button className="link" onClick={() => window.api.app.openPath(res.data.cv)}>CV</button>
                      <button className="link" onClick={() => window.api.app.openPath(res.data.cover)}>cover</button></>}
                    {Array.isArray(res.data) && res.data.length > 0 &&
                      <span className="muted small"> — {res.data.slice(0, 5).map((d: any) => d.title).join(', ')}…</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="agent-input">
        <textarea rows={2} value={input} placeholder="Tell the agent what to do…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="primary" onClick={send} disabled={busy}>{busy ? '…' : 'Send'}</button>
      </div>
    </div>
  );
}
