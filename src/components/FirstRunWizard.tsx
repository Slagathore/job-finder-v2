import React, { useState } from 'react';
import { toast } from '../lib/feedback';

/**
 * First-run wizard — shown once on a fresh profile (no onboarded flag, no
 * candidate name). Collects the three things that most cut time-to-value:
 * who you are, which AI backend to use, and whether the starter boards fit.
 * Every step is skippable; the Dashboard checklist covers whatever's skipped.
 */
export function FirstRunWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [ai, setAi] = useState<'ollama' | 'anthropic' | 'skip'>('ollama');
  const [key, setKey] = useState('');
  const [boards, setBoards] = useState<'keep' | 'clear'>('keep');
  const [saving, setSaving] = useState(false);

  async function finish(skipped = false) {
    setSaving(true);
    try {
      const patch: Record<string, any> = { onboarded: true };
      if (!skipped) {
        if (name.trim()) patch.candidateName = name.trim();
        if (email.trim()) patch.candidateEmail = email.trim();
        if (ai === 'anthropic' && key.trim()) patch.anthropicApiKey = key.trim();
        if (boards === 'clear') {
          const list = await window.api.boards.list();
          await Promise.all(list.map((b: any) => window.api.boards.setEnabled(b.id, false)));
        }
      }
      await window.api.settings.set(patch);
      if (!skipped) toast('You’re set up — the Dashboard checklist tracks the rest.', 'success');
    } catch (e: any) {
      toast(String(e?.message ?? e), 'error');
    } finally {
      setSaving(false);
      onDone();
    }
  }

  const steps: { title: string; body: React.ReactNode; canNext: boolean }[] = [
    {
      title: 'Welcome to Job Finder',
      canNext: true,
      body: (
        <>
          <p>A local-first job search command center: scan boards, discover roles that fit your real experience, tailor applications, and track everything — <b>all on your machine, nothing in a cloud</b>.</p>
          <p className="muted small">Three quick questions and you're in. Everything here can be changed later in Settings.</p>
        </>
      ),
    },
    {
      title: 'Who’s applying?',
      canNext: true,
      body: (
        <>
          <p className="muted small">Used on your tailored resumes and cover letters — never sent anywhere else.</p>
          <input placeholder="your name" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <input placeholder="your email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%' }} />
        </>
      ),
    },
    {
      title: 'AI backend',
      canNext: true,
      body: (
        <>
          <p className="muted small">AI powers matching, resume digestion, and tailoring. Scanning and tracking work fine without it.</p>
          <label style={{ display: 'block', margin: '6px 0' }}>
            <input type="radio" checked={ai === 'ollama'} onChange={() => setAi('ollama')} /> I run <b>Ollama</b> locally (free — also run <code>ollama pull nomic-embed-text</code>)
          </label>
          <label style={{ display: 'block', margin: '6px 0' }}>
            <input type="radio" checked={ai === 'anthropic'} onChange={() => setAi('anthropic')} /> Use an <b>Anthropic API key</b>
          </label>
          {ai === 'anthropic' && <input placeholder="sk-ant-…" value={key} onChange={e => setKey(e.target.value)} style={{ width: '100%', margin: '4px 0 8px' }} />}
          <label style={{ display: 'block', margin: '6px 0' }}>
            <input type="radio" checked={ai === 'skip'} onChange={() => setAi('skip')} /> Skip for now
          </label>
        </>
      ),
    },
    {
      title: 'Starter job sources',
      canNext: true,
      body: (
        <>
          <p className="muted small">The app ships with 35 company boards it can scan immediately — mostly tech/AI companies. Not your field? Start empty and add your own targets in the Boards tab (paste any careers-page URL; it learns the rest).</p>
          <label style={{ display: 'block', margin: '6px 0' }}>
            <input type="radio" checked={boards === 'keep'} onChange={() => setBoards('keep')} /> <b>Keep them</b> — good for trying the app right now
          </label>
          <label style={{ display: 'block', margin: '6px 0' }}>
            <input type="radio" checked={boards === 'clear'} onChange={() => setBoards('clear')} /> <b>Start empty</b> — I'll add boards for my own field
          </label>
        </>
      ),
    },
  ];

  const last = step === steps.length - 1;
  const s = steps[step];

  return (
    <div className="wizard-overlay">
      <div className="wizard">
        <div className="muted small">Step {step + 1} of {steps.length}</div>
        <h1>{s.title}</h1>
        {s.body}
        <div className="wizard-actions">
          <button className="link" onClick={() => finish(true)} disabled={saving}>Skip setup</button>
          <span style={{ flex: 1 }} />
          {step > 0 && <button onClick={() => setStep(step - 1)} disabled={saving}>Back</button>}
          <button className="primary" disabled={saving}
            onClick={() => (last ? finish(false) : setStep(step + 1))}>
            {saving ? '…' : last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
