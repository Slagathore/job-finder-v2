import React, { useEffect, useRef, useState } from 'react';
import { confirmDialog, toast } from '../lib/feedback';

interface Msg {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  plan?: { summary: string; steps: any[] };
  results?: any[];
}

interface ConvRow { id: number; title: string; mode: string; created_at: number; updated_at: number; message_count: number; }

type Mode = 'agent' | 'interview';

const MODE_LABEL: Record<Mode, string> = { agent: 'Agent', interview: 'Interview prep' };

const PLACEHOLDER: Record<Mode, string> = {
  agent: 'Tell the agent what to do...',
  interview: 'Tell me which job you are interviewing for...',
};

const EMPTY_HINT: Record<Mode, string> = {
  agent: 'Ask me to do anything. For example: scan all boards then discover my best fits, tailor a resume for job 12, or add a rule that says never apply to staffing agencies.',
  interview: 'Interview prep mode. Tell me the job and the company you are interviewing for and we will work through it together, one question at a time.',
};

/** Short, readable stamp for the history list. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Mirror of the text the main process persists, so a reopened thread reads the same. */
function replyText(r: { intent: string; explanation?: string; plan?: { summary: string }; error?: string }): string {
  if (r.intent === 'explanation') return r.explanation || '(no answer)';
  if (r.intent === 'valid') return r.plan?.summary || 'Here is a plan:';
  return `Sorry, that did not work. ${r.error || 'Could not form a plan.'}`;
}

export function AgentTab({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const [msgs, setMsgsRaw] = useState<Msg[]>([]);
  // Cap the rendered transcript — marathon sessions must not grow the DOM forever.
  const setMsgs = (fn: (m: Msg[]) => Msg[]) => setMsgsRaw(m => fn(m).slice(-200));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('agent');
  const [convId, setConvId] = useState<number | null>(null);
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [perms, setPerms] = useState<{ capability: string; mode: string }[]>([]);
  const [permsLoading, setPermsLoading] = useState(true);
  const [showPerms, setShowPerms] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { window.api.agent.permissions().then(p => { setPerms(p); setPermsLoading(false); }); }, []);
  useEffect(() => { refreshConvs(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  async function refreshConvs() {
    try { setConvs(await window.api.agent.conversations()); } catch { /* history is best-effort */ }
  }

  function newConversation() {
    setConvId(null);
    setMsgsRaw([]);
    setInput('');
  }

  async function openConversation(id: number) {
    const c = await window.api.agent.conversation(id);
    if (!c) { toast('That conversation is gone.', 'error'); refreshConvs(); return; }
    setConvId(c.id);
    setMode(c.mode === 'interview' ? 'interview' : 'agent');
    setMsgsRaw(c.messages.map(m => ({
      id: m.id, role: m.role, content: m.content, plan: m.plan, results: m.results,
    })).slice(-200));
  }

  async function removeConversation(c: ConvRow) {
    const ok = await confirmDialog({
      title: 'Delete conversation',
      message: `Delete "${c.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setConvs(await window.api.agent.deleteConversation(c.id));
    if (convId === c.id) newConversation();
    toast('Conversation deleted.', 'success');
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput(''); setBusy(true);
    setMsgs(m => [...m, { role: 'user', content: message }]);
    try {
      const r = await window.api.agent.plan({ message, conversationId: convId, mode });
      setConvId(r.conversationId ?? convId);
      setMsgs(m => [...m, {
        id: r.messageId,
        role: 'assistant',
        content: replyText(r),
        plan: r.intent === 'valid' ? r.plan : undefined,
      }]);
      refreshConvs();
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: `Sorry, that did not work. ${e?.message ?? String(e)}` }]);
    }
    setBusy(false);
  }

  async function runPlan(idx: number, steps: any[]) {
    setBusy(true);
    const messageId = msgs[idx]?.id ?? null;
    const r = await window.api.agent.run(steps, messageId);
    setMsgs(m => m.map((msg, i) => i === idx ? { ...msg, results: r.results } : msg));
    const openTabStep = [...r.results].reverse().find(s => s.openTab);
    if (openTabStep?.openTab) onOpenTab(openTabStep.openTab);
    setBusy(false);
  }

  async function setPermMode(capability: string, m: string) {
    setPerms(await window.api.agent.setPermission(capability, m));
  }

  async function confirmStep(mi: number, ri: number, res: any) {
    const out = await window.api.agent.runStep({ tool: res.tool, args: res.args }, msgs[mi]?.id ?? null, ri);
    setMsgs(ms => ms.map((m, i) => i !== mi ? m : { ...m, results: m.results!.map((r, k) => k === ri ? out : r) }));
    if ((out as any).openTab) onOpenTab((out as any).openTab);
  }

  return (
    <div className="panel agent-shell">
      <div className="agent agent-main">
        <div className="agent-head">
          <h1>Agent</h1>
          <div className="agent-head-acts">
            <button className="link" onClick={() => setShowPerms(s => !s)}>{showPerms ? 'hide' : 'permissions'}</button>
            <button className="link" onClick={() => setShowHistory(s => !s)}>{showHistory ? 'hide history' : 'history'}</button>
          </div>
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
                  <select value={p.mode} onChange={e => setPermMode(p.capability, e.target.value)}>
                    <option value="auto">auto</option><option value="confirm">confirm</option><option value="off">off</option>
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="chat">
          {msgs.length === 0 && <p className="muted">{EMPTY_HINT[mode]}</p>}
          {msgs.map((m, i) => (
            <div key={m.id ?? `local-${i}`} className={`bubble ${m.role}`}>
              <div>{m.content}</div>
              {m.plan && (
                <div className="plan">
                  <ol>{m.plan.steps.map((s: any, j: number) => <li key={j}><b>{s.tool}</b> {s.reason ? `(${s.reason})` : ''} <code>{JSON.stringify(s.args)}</code></li>)}</ol>
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
                        <span className="muted small"> ({res.data.slice(0, 5).map((d: any) => d.title).join(', ')})</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className="agent-input">
          <textarea rows={2} value={input} placeholder={PLACEHOLDER[mode]}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="primary" onClick={send} disabled={busy}>{busy ? '...' : 'Send'}</button>
        </div>

        <div className="agent-modes">
          {(['agent', 'interview'] as Mode[]).map(m => (
            <button key={m} className={`mode-btn ${mode === m ? 'on' : ''}`}
              onClick={() => setMode(m)} disabled={busy} type="button">
              {MODE_LABEL[m]}
            </button>
          ))}
          <span className="muted small">
            {mode === 'interview'
              ? 'Coaching mode. I ask the questions and give you feedback, and I will not run app actions.'
              : 'Normal mode. I plan and run actions in the app.'}
          </span>
        </div>
      </div>

      {showHistory && (
        <aside className="agent-side">
          <div className="agent-side-head">
            <h2>History</h2>
            <button className="link" onClick={newConversation}>New conversation</button>
          </div>
          {convs.length === 0 && <p className="muted small">Nothing saved yet. Send a message and it will show up here.</p>}
          <ul className="conv-list">
            {convs.map(c => (
              <li key={c.id} className={`conv ${convId === c.id ? 'on' : ''}`}>
                <button className="conv-open" onClick={() => openConversation(c.id)} title={c.title}>
                  <span className="conv-title">{c.title}</span>
                  <span className="muted small">
                    {stamp(c.updated_at)}{c.mode === 'interview' ? ' · interview prep' : ''}
                  </span>
                </button>
                <button className="link conv-del" onClick={() => removeConversation(c)} title="Delete">x</button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
