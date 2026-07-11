import React, { useEffect, useState } from 'react';
import { confirmDialog, toast } from '../lib/feedback';

export function ExperienceTab() {
  const [items, setItems] = useState<any[]>([]);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState('');
  const [profile, setProfile] = useState<any>(null);
  const [roleFits, setRoleFits] = useState<any[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState('');
  const [rules, setRules] = useState<any[]>([]);
  const [ruleText, setRuleText] = useState('');
  const [ruleScope, setRuleScope] = useState('resume');
  const [llmDown, setLlmDown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stories, setStories] = useState<any[]>([]);
  const [storyPrompt, setStoryPrompt] = useState('');
  const [storyText, setStoryText] = useState('');

  async function refresh() {
    try {
      setItems(await window.api.experience.list());
      const p = await window.api.experience.getProfile();
      setProfile(p.profile); setRoleFits(p.roleFits ?? []);
      setRules(await window.api.rules.list());
      setStories(await window.api.stories.list());
      const h = await window.api.llm.health();
      setLlmDown(!(h.ollamaUp || h.anthropicConfigured));
    } finally {
      setLoading(false);
    }
  }

  async function addStoryManual() {
    if (!storyPrompt.trim() || !storyText.trim()) { toast('Both the question and the story are required', 'error'); return; }
    const r = await window.api.stories.add(storyPrompt.trim(), storyText.trim());
    if (r?.error) { toast(r.error, 'error'); return; }
    setStoryPrompt(''); setStoryText('');
    setStories(await window.api.stories.list());
  }
  async function delStory(id: number) {
    await window.api.stories.delete(id);
    setStories(await window.api.stories.list());
  }
  const NEED_AI = 'No line items created — the AI isn’t connected. Start Ollama (and `ollama pull nomic-embed-text`) or set an Anthropic key in Settings.';
  useEffect(() => { refresh(); }, []);

  async function addRule() {
    if (!ruleText.trim()) return;
    await window.api.rules.add(ruleScope, ruleText.trim());
    setRuleText(''); setRules(await window.api.rules.list());
  }
  async function delRule(id: number) {
    const ok = await confirmDialog({ title: 'Remove rule', message: 'Remove this rule?', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await window.api.rules.delete(id); setRules(await window.api.rules.list());
  }

  async function importFile() {
    const fp = await window.api.app.pickPath({
      properties: ['openFile'],
      filters: [{ name: 'Resumes/Docs', extensions: ['pdf', 'docx', 'md', 'txt'] }],
    });
    if (!fp) return;
    setBusy('Reading + digesting file…');
    const r = await window.api.experience.importFile(fp);
    setBusy('');
    if ('error' in r) toast(r.error, 'error');
    else if (r.added === 0) toast(NEED_AI, 'error');
    else toast(`Added ${r.added} line items from ${r.source}.`, 'success');
    refresh();
  }

  async function digestPaste() {
    if (!paste.trim()) return;
    setBusy('Digesting text…');
    const r = await window.api.experience.importText(paste, 'pasted');
    setBusy('');
    if ('error' in r) toast(r.error, 'error');
    else if (r.added === 0) toast(NEED_AI, 'error');
    else { toast(`Added ${r.added} line items.`, 'success'); setPaste(''); }
    refresh();
  }

  async function analyze() {
    setBusy('Analyzing experience → profile & role fits…');
    const r = await window.api.experience.infer();
    setBusy('');
    if ('error' in r) toast(r.error, 'error');
    else { setProfile(r.profile); setRoleFits(r.roleFits); }
  }

  async function getQuestions() {
    setBusy('Thinking of questions…');
    const r = await window.api.experience.suggestQuestions();
    setBusy('');
    setQuestions('error' in r ? [] : r.questions);
  }

  async function digestAnswers() {
    if (!answers.trim()) return;
    setBusy('Digesting answers…');
    await window.api.experience.importText(answers, 'qa');
    setBusy(''); setAnswers(''); toast('Answers digested into line items.', 'success');
    refresh();
  }

  const [roast, setRoast] = useState('');
  async function roastMe() {
    setBusy('Roasting your résumé…'); setRoast('');
    const r = await window.api.experience.roast();
    setBusy('');
    setRoast('error' in r ? `⚠️ ${r.error}` : r.text);
  }
  async function del(id: number) { await window.api.experience.delete(id); refresh(); }
  async function clearAll() {
    const ok = await confirmDialog({ title: 'Delete all experience', message: 'Delete ALL experience line items? This cannot be undone.', confirmLabel: 'Delete all', danger: true });
    if (!ok) return;
    await window.api.experience.clear(); refresh();
  }

  return (
    <div className="panel" style={{ maxWidth: 900 }}>
      <h1>Experience</h1>
      {llmDown && <div className="banner">⚠️ AI not connected — importing &amp; analyzing need it. Start <b>Ollama</b> (then <code>ollama pull nomic-embed-text</code>) or add an <b>Anthropic key</b> in Settings.</div>}
      <p className="muted small">
        Import resumes or paste text. The model digests everything into atomic, reusable line items,
        then infers which role families &amp; industries you can target.
      </p>

      <div className="row">
        <button className="primary" onClick={importFile} disabled={!!busy}>Import file (PDF/DOCX/MD)</button>
        <span className="muted small">{items.length} line items</span>
        {items.length > 0 && <button className="link" onClick={clearAll}>clear all</button>}
      </div>

      <textarea rows={4} placeholder="…or paste resume / experience text here" value={paste} onChange={e => setPaste(e.target.value)} />
      <div className="row">
        <button className="primary" onClick={digestPaste} disabled={!!busy || !paste.trim()}>Digest text</button>
        {busy && <span className="muted small">{busy}</span>}
      </div>

      <div className="row">
        <button className="primary" onClick={analyze} disabled={!!busy || items.length === 0}>Analyze → profile &amp; roles</button>
        <button className="primary" onClick={getQuestions} disabled={!!busy}>Suggest gap questions</button>
        <button className="primary" onClick={roastMe} disabled={!!busy || items.length === 0}>🔥 Roast my résumé</button>
      </div>
      {roast && <pre className="out" style={{ whiteSpace: 'pre-wrap' }}>{roast}</pre>}

      {questions.length > 0 && (
        <div className="qa">
          <h2>Questions to fill gaps</h2>
          <ol>{questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
          <textarea rows={4} placeholder="Answer any of the above here, then digest" value={answers} onChange={e => setAnswers(e.target.value)} />
          <div className="row"><button className="primary" onClick={digestAnswers} disabled={!answers.trim()}>Digest answers</button></div>
        </div>
      )}

      <div className="profile-card" style={{ marginTop: 12 }}>
        <h2>Rules</h2>
        <p className="muted small">Guidance for how the model tailors resumes &amp; searches (e.g. “always lead with lab-automation impact”, “never apply to staffing agencies”).</p>
        <div className="addform">
          <select value={ruleScope} onChange={e => setRuleScope(e.target.value)}>
            <option value="resume">resume</option>
            <option value="search">search</option>
            <option value="scoring">scoring</option>
            <option value="apply">apply</option>
          </select>
          <input placeholder="add a rule…" value={ruleText} onChange={e => setRuleText(e.target.value)} />
          <button className="primary" onClick={addRule}>Add</button>
        </div>
        {rules.length > 0 && (
          <ul className="rules">
            {rules.map(r => (
              <li key={r.id}><span className="chip">{r.scope}</span> {r.text}
                <button className="link" aria-label={`Remove rule: ${r.text}`} onClick={() => delRule(r.id)}>×</button></li>
            ))}
          </ul>
        )}
      </div>

      <div className="profile-card" style={{ marginTop: 12 }}>
        <h2>Story bank</h2>
        <p className="muted small">Your reusable STAR interview stories. Interview prep saves its generated stories here and reuses them for future jobs — refine the good ones, delete the weak ones.</p>
        <div className="addform">
          <input placeholder="behavioral question (e.g. tell me about a time you handled conflict)" value={storyPrompt} onChange={e => setStoryPrompt(e.target.value)} />
          <button className="primary" onClick={addStoryManual}>Add</button>
        </div>
        <textarea placeholder="the story — situation, task, action, result" value={storyText} onChange={e => setStoryText(e.target.value)}
          style={{ width: '100%', minHeight: 60, marginTop: 6 }} />
        {stories.length > 0 && (
          <ul className="rules">
            {stories.map(s => (
              <li key={s.id}><b>{s.prompt}</b><br /><span className="muted small">{s.story}</span>
                {s.source_job && <span className="muted small"> · from prep</span>}
                <button className="link" aria-label={`Delete story: ${s.prompt}`} onClick={() => delStory(s.id)}>×</button></li>
            ))}
          </ul>
        )}
      </div>

      {profile && (
        <div className="profile-card">
          <h2>Profile</h2>
          {profile.narrative && <p>{profile.narrative}</p>}
          <p className="muted small">
            {profile.seniority ?? '—'} · {profile.total_yoe ?? '?'} yrs ·{' '}
            {(profile.domains ?? []).join(', ') || 'no domains'}
          </p>
          {(profile.skills ?? []).length > 0 && (
            <div className="chips">{profile.skills.map((s: string, i: number) => <span className="chip" key={i}>{s}</span>)}</div>
          )}
        </div>
      )}

      {roleFits.length > 0 && (
        <>
          <h2>Role / industry fits</h2>
          <table className="jobs">
            <thead><tr><th>Role family</th><th>Industry</th><th>Conf.</th><th>Why</th></tr></thead>
            <tbody>
              {roleFits.map((r: any, i: number) => (
                <tr key={i}>
                  <td>{r.role_family}</td>
                  <td className="muted small">{r.industry || '—'}</td>
                  <td>{Math.round((r.confidence ?? 0) * 100)}%</td>
                  <td className="muted small">{r.rationale || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {loading ? (
        <>
          <h2>Line items</h2>
          <div className="loading-bar medium" />
          <div className="loading-bar long" />
        </>
      ) : items.length > 0 && (
        <>
          <h2>Line items</h2>
          <table className="jobs">
            <thead><tr><th>Kind</th><th>Item</th><th>Where</th><th></th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id}>
                  <td className="muted small">{i.kind}</td>
                  <td>{i.text}</td>
                  <td className="muted small">{i.employer || i.role || '—'}</td>
                  <td><button className="link" aria-label={`Delete line item: ${i.text}`} onClick={() => del(i.id)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
