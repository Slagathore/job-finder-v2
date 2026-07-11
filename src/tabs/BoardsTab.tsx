import React, { useEffect, useState } from 'react';
import { confirmDialog, toast } from '../lib/feedback';

export function BoardsTab() {
  const [boards, setBoards] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [rowStatus, setRowStatus] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  async function refresh() { try { setBoards(await window.api.boards.list()); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, []);

  async function probe(b: any) {
    setRowStatus(s => ({ ...s, [b.id]: 'probing…' }));
    const r = await window.api.boards.probe(b.url, b.id);
    setRowStatus(s => ({ ...s, [b.id]: 'error' in r ? `⚠️ ${r.error}` : `${r.ingress}/${r.method} · ${r.count} jobs${r.note ? ` — ${r.note}` : ''}` }));
    refresh();
  }
  async function learn(b: any) {
    setRowStatus(s => ({ ...s, [b.id]: 'learning selectors (LLM)…' }));
    const r = await window.api.boards.learn(b.url, b.id);
    setRowStatus(s => ({ ...s, [b.id]: 'error' in r ? `⚠️ ${r.error}` : `learned adapter · ${r.count} jobs found (saved)` }));
    refresh();
  }

  async function add() {
    if (!name.trim() || !url.trim()) return;
    const r = await window.api.boards.add({ name: name.trim(), url: url.trim() });
    toast(r.detected ? `Added — detected ${r.detected} API ✓` : 'Added — no ATS API detected (DOM adapter needed, phase 7)', r.detected ? 'success' : 'info');
    setName(''); setUrl('');
    refresh();
  }

  async function toggle(id: number, enabled: boolean) {
    await window.api.boards.setEnabled(id, enabled);
    refresh();
  }
  async function remove(id: number, boardName: string) {
    const ok = await confirmDialog({ title: 'Remove board', message: `Remove "${boardName}" from tracked boards?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await window.api.boards.delete(id);
    refresh();
  }

  const enabledCount = boards.filter(b => b.enabled).length;

  return (
    <div className="panel">
      <h1>Boards</h1>
      <p className="muted small">{boards.length} boards · {enabledCount} enabled. Disabled boards are skipped during scans.</p>

      <div className="addform">
        <input placeholder="Company / board name" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="Careers URL (Greenhouse / Ashby / Lever)" value={url} onChange={e => setUrl(e.target.value)} />
        <button className="primary" onClick={add}>Add</button>
      </div>

      <p className="muted small">“Probe” finds the easiest ingress (ATS API → JSON-LD → DOM). If it says <i>dom</i>, “Learn” has the LLM infer selectors and saves a reusable adapter.</p>
      {loading ? (
        <>
          <div className="loading-bar long" />
          <div className="loading-bar medium" />
          <div className="loading-bar short" />
        </>
      ) : boards.length === 0 ? (
        <p className="muted">No boards tracked yet — add one above.</p>
      ) : (
        <table className="jobs">
          <thead><tr><th>On</th><th>Name</th><th>Ingress</th><th>URL</th><th>Actions</th></tr></thead>
          <tbody>
            {boards.map(b => (
              <tr key={b.id}>
                <td><input type="checkbox" aria-label={`Enable scanning for ${b.name}`} checked={!!b.enabled} onChange={e => toggle(b.id, e.target.checked)} /></td>
                <td>{b.name}{rowStatus[b.id] && <div className={rowStatus[b.id].startsWith('⚠️') ? 'msg-error' : 'muted small'}>{rowStatus[b.id]}</div>}</td>
                <td className="muted small">{b.ingress}{b.status ? ` (${b.status})` : ''}{b.adapter_stale ? <span className="sev-high"> ⚠ stale — re-learn</span> : ''}</td>
                <td className="muted small">{b.url}</td>
                <td className="rowacts">
                  <button className="link" aria-label={`Probe ${b.name}`} onClick={() => probe(b)}>probe</button>
                  <button className="link" aria-label={`Learn selectors for ${b.name}`} onClick={() => learn(b)}>learn</button>
                  <button className="link" aria-label={`Remove ${b.name}`} onClick={() => remove(b.id, b.name)}>remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
