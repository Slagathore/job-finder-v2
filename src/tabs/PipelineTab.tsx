import React, { useEffect, useState } from 'react';

const LABELS: Record<string, string> = {
  discovered: 'Discovered', tailored: 'Tailored', applied: 'Applied',
  responded: 'Responded', interview: 'Interview', offer: 'Offer', rejected: 'Rejected',
};

const PAGE_SIZE = 25;

export function PipelineTab() {
  const [board, setBoard] = useState<{ columns: Record<string, any[]>; counts: Record<string, number>; order: string[] } | null>(null);
  const [feed, setFeed] = useState<any[]>([]);
  const [dragId, setDragId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function refresh() {
    try {
      setBoard(await window.api.pipeline.board());
      setFeed(await window.api.notifications.list());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    const off = window.api.notifications.onNotify(() => refresh());
    return () => off();
  }, []);

  async function drop(col: string) {
    if (dragId == null) return;
    await window.api.pipeline.move(dragId, col);
    setDragId(null);
    refresh();
  }

  async function move(jobId: number, col: string) {
    await window.api.pipeline.move(jobId, col);
    refresh();
  }

  async function clearFeed() { await window.api.notifications.markAllSeen(); refresh(); }

  function describe(n: any) {
    if (n.kind === 'jobs') return `${n.payload?.added} new jobs from a scan`;
    if (n.kind === 'email') return `${n.payload?.classification ?? 'email'}: ${n.payload?.subject ?? ''}`;
    if (n.kind === 'watch') return `📡 ${n.payload?.company} posted: ${n.payload?.title}`;
    return n.kind;
  }

  async function exportPipeline() {
    const r = await window.api.exportData.pipeline();
    window.api.app.openPath(r.html);
  }

  function toggleExpanded(col: string) {
    setExpanded(e => ({ ...e, [col]: !e[col] }));
  }

  return (
    <div className="panel" style={{ maxWidth: 1300 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Pipeline</h1>
        <button className="link" onClick={exportPipeline}>export (CSV + HTML)</button>
      </div>

      {feed.length > 0 && (
        <div className="feed">
          <div className="feed-head"><b>Activity</b><button className="link" onClick={clearFeed}>mark all read</button></div>
          {feed.slice(0, 6).map(n => (
            <div key={n.id} className={`feed-item ${n.seen ? '' : 'unseen'}`}>
              {describe(n)} <span className="muted small">· {new Date(n.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <>
          <div className="loading-bar long" />
          <div className="loading-bar medium" />
          <div className="loading-bar short" />
        </>
      ) : !board ? <p className="muted">No pipeline data yet.</p> : (
        <div className="kanban" role="list">
          {board.order.map((col, colIdx) => {
            const cards = board.columns[col] ?? [];
            const isExpanded = !!expanded[col];
            const visible = isExpanded ? cards : cards.slice(0, PAGE_SIZE);
            const prevCol = board.order[colIdx - 1];
            const nextCol = board.order[colIdx + 1];
            return (
              <div
                key={col}
                className="kcol"
                role="listitem"
                onDragOver={e => e.preventDefault()}
                onDrop={() => drop(col)}
              >
                <div className="kcol-head">{LABELS[col] ?? col} <span className="muted small">{board.counts[col]}</span></div>
                <div className="kcol-body" role="list" aria-label={`${LABELS[col] ?? col} cards`}>
                  {visible.map(c => (
                    <div
                      key={c.jobId}
                      className="kcard"
                      role="listitem"
                      draggable
                      onDragStart={() => setDragId(c.jobId)}
                    >
                      <div className="kcard-title"><a href={c.url} target="_blank" rel="noreferrer">{c.title}</a></div>
                      <div className="muted small">{c.company}</div>
                      <div className="kcard-meta">
                        {c.fit_score && <span className="badge">{c.fit_score}</span>}
                        {c.work_mode && <span className="muted small">{c.work_mode}</span>}
                        {c.route && <span className="muted small">· {c.route}</span>}
                      </div>
                      {c.submitted_at && <div className="muted small">applied {new Date(c.submitted_at).toLocaleDateString()}</div>}
                      <div className="kcard-acts">
                        {c.cv && <button className="link" aria-label={`Open CV for ${c.title}`} onClick={() => window.api.app.openPath(c.cv)}>CV</button>}
                        <button
                          className="link"
                          aria-label={`Open application prep for ${c.title}`}
                          onClick={async () => { const r = await window.api.apply.prep(c.jobId); if (!('error' in r)) window.api.app.openPath(r.path); }}
                        >
                          prep
                        </button>
                        <span className="kcard-nav">
                          <button
                            className="link"
                            aria-label={`Move ${c.title} to ${LABELS[prevCol] ?? prevCol ?? 'previous column'}`}
                            disabled={!prevCol}
                            onClick={() => prevCol && move(c.jobId, prevCol)}
                          >‹</button>
                          <button
                            className="link"
                            aria-label={`Move ${c.title} to ${LABELS[nextCol] ?? nextCol ?? 'next column'}`}
                            disabled={!nextCol}
                            onClick={() => nextCol && move(c.jobId, nextCol)}
                          >›</button>
                        </span>
                      </div>
                    </div>
                  ))}
                  {cards.length === 0 && <div className="muted small kempty">—</div>}
                  {cards.length > PAGE_SIZE && (
                    <button className="link" onClick={() => toggleExpanded(col)}>
                      {isExpanded ? 'show less' : `show all ${cards.length}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="muted small">Drag a card to move it through the pipeline, or use the ‹ › buttons. (Email-driven status updates arrive with the Gmail integration, phase 13.)</p>
    </div>
  );
}
