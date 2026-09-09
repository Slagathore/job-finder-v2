import React, { useEffect, useState } from 'react';
import { confirmDialog, toast } from '../lib/feedback';
import type { Direction, IntakeAnswers, IntakeQuestion, IntakeState, StoredDirection } from '../types';

const pct = (n: number) => `${Math.round((n ?? 0) * 100)}%`;

function when(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString() : '';
}

/** One intake question, rendered by type. */
function Question({ q, value, onChange }: { q: IntakeQuestion; value: any; onChange: (v: any) => void }) {
  const label = <b className="small">{q.label}{q.required ? ' *' : ''}</b>;
  return (
    <div style={{ marginBottom: 12 }}>
      <div>{label}</div>
      {q.help && <div className="muted small" style={{ margin: '2px 0 4px' }}>{q.help}</div>}
      {q.type === 'multi' ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(q.options ?? []).map(o => {
            const on = Array.isArray(value) && value.includes(o);
            return (
              <button key={o} type="button" className={on ? 'primary' : ''} aria-pressed={on}
                onClick={() => {
                  const cur: string[] = Array.isArray(value) ? value : [];
                  onChange(on ? cur.filter(x => x !== o) : [...cur, o]);
                }}>{o}</button>
            );
          })}
        </div>
      ) : q.type === 'single' ? (
        <select value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)}>
          <option value="">choose one</option>
          {(q.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          inputMode={q.type === 'number' ? 'numeric' : undefined}
          placeholder={q.placeholder ?? ''}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

interface WriteRecord { label: string; searchIds: number[]; fitIds: number[] }

/**
 * Career direction: the preference intake, the synthesis over everything on
 * file, and the two writes it can make. Both writes are previewed before they
 * happen and undoable after, so nothing changes without being seen first.
 */
export function CareerDirectionCard() {
  const [intake, setIntake] = useState<IntakeState | null>(null);
  const [draft, setDraft] = useState<IntakeAnswers>({});
  const [editing, setEditing] = useState(false);
  const [stored, setStored] = useState<StoredDirection | null>(null);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [plan, setPlan] = useState<{ index: number; kind: 'searches' | 'fits'; data: any } | null>(null);
  const [lastWrite, setLastWrite] = useState<WriteRecord | null>(null);

  useEffect(() => {
    window.api.career.intakeGet().then(s => {
      setIntake(s);
      setDraft(s.answers);
      setEditing(s.missing.length > 0);
    });
    window.api.career.directionGet().then(d => setStored(d));
  }, []);

  async function saveIntake() {
    setBusy('intake');
    const s = await window.api.career.intakeSave(draft);
    setBusy('');
    setIntake(s);
    setDraft(s.answers);
    if (s.missing.length) {
      toast(`Saved. Still needed: ${s.missingLabels.join(', ')}.`, 'error');
      return;
    }
    setEditing(false);
    toast('Preferences saved. It will not ask again.', 'success');
  }

  async function run(force: boolean) {
    if (force) {
      const ok = await confirmDialog({
        title: 'Run it again',
        message: 'This replaces the report you are looking at with a fresh one. Saved searches and role fits you already created stay where they are.',
        confirmLabel: 'Run it again',
      });
      if (!ok) return;
    }
    setBusy('run');
    const r = await window.api.career.direction(force);
    setBusy('');
    if ('error' in r) { toast(r.error, 'error'); return; }
    setStored(r);
    setOpen(0);
  }

  async function preview(index: number, kind: 'searches' | 'fits') {
    setBusy(`plan-${index}-${kind}`);
    const r = await window.api.career.directionPlan(index, kind);
    setBusy('');
    if (r && 'error' in r) { toast(r.error, 'error'); return; }
    setPlan({ index, kind, data: r });
  }

  async function applyPlan() {
    if (!plan) return;
    setBusy('apply');
    const r = await window.api.career.directionApply(plan.index, plan.kind);
    setBusy('');
    if (r && 'error' in r) { toast(r.error, 'error'); return; }
    if ('created' in r) {
      const created = r.created ?? [];
      setLastWrite({ label: `Saved search "${created[0]?.name ?? ''}"`, searchIds: created.map(c => c.id), fitIds: [] });
      toast(`Created ${created.length} saved search. Open the Search tab to run it.`, 'success');
    } else {
      const added = r.added ?? [];
      if (!added.length) toast('Nothing to add, those role fits are already on file.', 'info');
      else {
        setLastWrite({ label: `${added.length} role fit${added.length === 1 ? '' : 's'} added`, searchIds: [], fitIds: added.map(a => a.id) });
        toast(`Added ${added.length} role fit${added.length === 1 ? '' : 's'}.`, 'success');
      }
    }
    setPlan(null);
  }

  async function undo() {
    if (!lastWrite) return;
    setBusy('undo');
    const r = await window.api.career.directionUndo({ searchIds: lastWrite.searchIds, fitIds: lastWrite.fitIds });
    setBusy('');
    toast(`Undone. Removed ${r.searchesRemoved} saved search and ${r.fitsRemoved} role fit rows.`, 'success');
    setLastWrite(null);
  }

  const questions = intake?.questions ?? [];
  const answered = intake && !intake.missing.length;

  return (
    <div className="profile-card">
      <h2>Career direction</h2>
      <p className="muted small">
        A guided read on what you should actually go after. It uses your line items, your projects, your
        education, your role fits and the preferences below, then turns a direction you pick into a real search.
      </p>

      {!intake ? <div className="loading-bar short" /> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <b className="small">Preferences</b>
            {intake.updatedAt && <span className="muted small">saved {when(intake.updatedAt)}</span>}
            <button className="link" onClick={() => setEditing(e => !e)}>{editing ? 'hide' : 'change my answers'}</button>
          </div>
          {!editing && !answered && (
            <p className="small">Answer these first, it takes a couple of minutes: {intake.missingLabels.join(', ')}.</p>
          )}
          {editing && (
            <div style={{ marginBottom: 10 }}>
              {questions.map(q => (
                <Question key={q.id} q={q} value={(draft as any)[q.id]}
                  onChange={v => setDraft(d => ({ ...d, [q.id]: v }))} />
              ))}
              <button className="primary" onClick={saveIntake} disabled={!!busy}>
                {busy === 'intake' ? '…' : 'Save preferences'}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button className="primary" onClick={() => run(false)} disabled={!!busy || !answered}>
              {busy === 'run' ? 'Thinking, this one takes a while…' : stored ? 'Show my direction report' : 'Run the deep dive'}
            </button>
            {stored && <button onClick={() => run(true)} disabled={!!busy}>Run it again</button>}
            {stored && <span className="muted small">report from {when(stored.createdAt)}, {stored.itemCount} line items</span>}
          </div>
        </>
      )}

      {lastWrite && (
        <p className="small" style={{ marginTop: 8 }}>
          {lastWrite.label}. <button className="link" onClick={undo} disabled={!!busy}>Undo that</button>
        </p>
      )}

      {stored && (
        <div style={{ marginTop: 12 }}>
          {stored.report.summary && <p>{stored.report.summary}</p>}
          {stored.report.adjacency_note && <p className="small">{stored.report.adjacency_note}</p>}
          {stored.report.directions.map((d: Direction, i: number) => (
            <div key={i} style={{ borderTop: '1px solid var(--border, #333)', paddingTop: 8, marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <button className="link" onClick={() => setOpen(open === i ? null : i)}><b>{i + 1}. {d.title}</b></button>
                <span className="pill">{pct(d.fit)} fit</span>
                {d.kind === 'adjacency' && <span className="pill pill-high">not on your list yet</span>}
              </div>
              {open === i && (
                <div style={{ marginTop: 6 }}>
                  <p className="small">{d.why}</p>
                  {d.evidence.length > 0 && <>
                    <b className="small">Evidence from your own record</b>
                    <ul className="rules">{d.evidence.map((e, k) => <li key={k}>{e}</li>)}</ul>
                  </>}
                  {d.gaps.length > 0 && <>
                    <b className="small">Honest gaps</b>
                    <ul className="rules">{d.gaps.map((g, k) => <li key={k}>{g}</li>)}</ul>
                  </>}
                  {d.pay && <p className="small"><b>Pay:</b> {d.pay}</p>}
                  {d.demand && <p className="small"><b>Demand:</b> {d.demand}</p>}
                  {d.titles.length > 0 && <p className="muted small"><b>Titles to search:</b> {d.titles.join(', ')}</p>}
                  {d.industries.length > 0 && <p className="muted small"><b>Industries:</b> {d.industries.join(', ')}</p>}
                  {d.next_step && <p className="small"><b>Next step:</b> {d.next_step}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => preview(i, 'searches')} disabled={!!busy}>Turn this into a saved search</button>
                    <button onClick={() => preview(i, 'fits')} disabled={!!busy}>Add to my role fits</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {stored.report.honest_note && (
            <p className="small" style={{ marginTop: 10 }}><b>The honest part:</b> {stored.report.honest_note}</p>
          )}
        </div>
      )}

      {plan && (
        <div style={{ marginTop: 12, background: 'var(--panel2)', padding: 10, borderRadius: 8 }}>
          <b className="small">Here is exactly what this will write</b>
          {plan.kind === 'searches' ? (
            <>
              <p className="small" style={{ margin: '6px 0' }}>
                A new saved search named “{plan.data.name}”. Nothing existing is changed or removed.
              </p>
              <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(plan.data.params, null, 2)}</pre>
            </>
          ) : (
            <>
              {plan.data.additions?.length ? (
                <ul className="rules">
                  {plan.data.additions.map((a: any, k: number) => (
                    <li key={k}>{a.role_family}{a.industry ? ` in ${a.industry}` : ''} at {pct(a.confidence)} confidence</li>
                  ))}
                </ul>
              ) : <p className="small">Nothing new to add here.</p>}
              {plan.data.alreadyPresent?.length > 0 && (
                <p className="muted small">Already on file, so it will be left alone: {plan.data.alreadyPresent.join(', ')}.</p>
              )}
              <p className="muted small">Your profile and your existing role fits are not touched. This only adds rows.</p>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="primary" onClick={applyPlan} disabled={!!busy}>{busy === 'apply' ? '…' : 'Do it'}</button>
            <button onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
