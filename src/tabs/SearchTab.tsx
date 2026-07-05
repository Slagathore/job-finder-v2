import React, { useEffect, useState } from 'react';
import { toast, promptDialog } from '../lib/feedback';

const MODES = ['remote', 'hybrid', 'onsite'];

export function SearchTab() {
  const [roleFits, setRoleFits] = useState<any[]>([]);
  const [roleFamily, setRoleFamily] = useState('');
  const [tags, setTags] = useState('');
  const [keyword, setKeyword] = useState('');
  const [modes, setModes] = useState<string[]>([]);
  const [payMin, setPayMin] = useState('');
  const [sort, setSort] = useState<'fit' | 'pay' | 'date' | 'distance'>('fit');

  const [locText, setLocText] = useState('');
  const [loc, setLoc] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [radius, setRadius] = useState('50');

  const [rows, setRows] = useState<any[]>([]);
  const [coverage, setCoverage] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [grades, setGrades] = useState<Record<number, { grade: string; rationale: string }>>({});
  const [docs, setDocs] = useState<Record<number, any>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [prepared, setPrepared] = useState<any[] | null>(null);
  const [sal, setSal] = useState<Record<number, any>>({});
  const [saved, setSaved] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    window.api.experience.getProfile().then(p => setRoleFits(p.roleFits ?? []));
    window.api.searches.list().then(setSaved);
    window.api.searches.history().then(setHistory);
    window.api.settings.get().then(s => {
      if (s.searchRadiusMi) setRadius(String(s.searchRadiusMi));
      if (Array.isArray(s.homeLocations) && s.homeLocations[0]) {
        setLoc(s.homeLocations[0]); setLocText(s.homeLocations[0].label);
      }
    });
  }, []);

  function toggleMode(m: string) {
    setModes(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  }

  async function resolveLoc() {
    if (!locText.trim()) { setLoc(null); return; }
    setBusy('Resolving location…');
    const r = await window.api.geo.resolve(locText.trim());
    setBusy('');
    if ('error' in r) { setLoc(null); setMsg(`⚠️ ${r.error}`); }
    else { setLoc(r); setMsg(`Location: ${r.label} (${r.source})`); }
  }
  async function saveHome() {
    if (!loc) return;
    await window.api.settings.set({ homeLocations: [loc], searchRadiusMi: Number(radius) || 50 });
    setMsg(`Saved home location: ${loc.label}`);
  }

  async function embed() {
    setBusy('Embedding jobs + experience (local model)…'); setMsg('');
    const r = await window.api.discovery.embed(false);
    setBusy('');
    setMsg('error' in r ? `⚠️ ${r.error}` : `Embedded ${r.jobsEmbedded} jobs + ${r.itemsEmbedded} line items.`);
  }
  async function geocodeJobs() {
    setBusy('Geocoding job locations (throttled)…'); setMsg('');
    const r = await window.api.geo.geocodeJobs(80);
    setBusy('');
    setMsg('error' in r ? `⚠️ ${r.error}` : `Geocoded ${r.resolved} (${r.failed} failed, ${r.remaining} remaining).`);
  }

  function savedObj() {
    return {
      tags, roleFamily, keyword, workModes: modes, sort, locText,
      payMin: Number(payMin) || 0, radiusMi: Number(radius) || 0,
      location: loc ? { lat: loc.lat, lng: loc.lng } : null,
    };
  }
  async function execSearch(p: any) {
    setBusy('Searching…'); setMsg('');
    const r = await window.api.discovery.search({ ...p, limit: 100 });
    setBusy('');
    if ('error' in r) { setMsg(`⚠️ ${r.error}`); return; }
    setRows(r.results); setCoverage(r.embeddedCoverage);
    window.api.searches.log(p).then(() => window.api.searches.history().then(setHistory));
    if (r.embeddedCoverage.items === 0) setMsg('No experience embeddings — import experience + click “Embed”. Showing keyword/filter results.');
    else if (r.embeddedCoverage.jobs === 0) setMsg('No job embeddings yet — click “Embed”. Showing keyword/filter results.');
  }
  async function runSearch() { await execSearch(savedObj()); }
  async function saveSearch() {
    const name = await promptDialog({ title: 'Save search', message: 'Name this search', placeholder: 'e.g. PM · remote · DFW' });
    if (!name) return;
    await window.api.searches.save(name, savedObj());
    setSaved(await window.api.searches.list());
    toast(`Saved “${name}”.`, 'success');
  }
  function loadParams(p: any) {
    setTags(p.tags || ''); setRoleFamily(p.roleFamily || ''); setKeyword(p.keyword || '');
    setModes(p.workModes || []); setPayMin(p.payMin ? String(p.payMin) : ''); setSort(p.sort || 'fit');
    setLocText(p.locText || ''); setRadius(p.radiusMi ? String(p.radiusMi) : '50');
    setLoc(p.location ? { lat: p.location.lat, lng: p.location.lng, label: p.locText || 'saved' } : null);
    execSearch(p);
  }

  // One-click Indeed: build a real Indeed search URL from the current filters
  // and open it in the default browser. With the extension paired and
  // auto-harvest on, results (and pagination) stream straight into the DB.
  function indeedUrl(): string | null {
    const q = keyword.trim()
      || tags.split(',').map(t => t.trim()).filter(Boolean).join(' ')
      || roleFamily;
    if (!q) return null;
    const u = new URL('https://www.indeed.com/jobs');
    u.searchParams.set('q', q);
    const remoteOnly = modes.length === 1 && modes[0] === 'remote';
    const l = remoteOnly ? 'Remote' : locText.trim();
    if (l) u.searchParams.set('l', l);
    const r = Number(radius);
    if (!remoteOnly && l && r > 0) u.searchParams.set('radius', String(Math.min(100, r)));
    return u.toString();
  }
  async function openIndeed() {
    const u = indeedUrl();
    if (!u) { toast('Add tags, a keyword, or pick a role family first.', 'error'); return; }
    await window.api.app.openExternal(u);
    toast('Indeed opened — with the extension paired + auto-harvest on, jobs stream in here automatically.');
  }

  async function discover() {
    setBusy('Surfacing best-fit jobs…'); setMsg('');
    const r = await window.api.discovery.discover(40);
    setBusy('');
    if ('error' in r) { setMsg(`⚠️ ${r.error}`); return; }
    if (r.note) setMsg(r.note);
    setRows(r.results); setCoverage(null);
  }

  async function grade(id: number) {
    setGrades(g => ({ ...g, [id]: { grade: '…', rationale: '' } }));
    const r = await window.api.discovery.grade(id);
    if ('error' in r) setGrades(g => ({ ...g, [id]: { grade: '!', rationale: r.error } }));
    else setGrades(g => ({ ...g, [id]: r }));
  }
  async function star(j: any) {
    await window.api.jobs.setStar(j.id, !j.starred);
    setRows(rs => rs.map(r => r.id === j.id ? { ...r, starred: r.starred ? 0 : 1 } : r));
  }
  async function tailor(id: number) {
    setDocs(d => ({ ...d, [id]: { busy: true } }));
    const r = await window.api.apply.tailor(id);
    setDocs(d => ({ ...d, [id]: 'error' in r ? { error: r.error } : r }));
  }
  const openPath = (p: string) => window.api.app.openPath(p);

  function toggleSelect(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  async function prepareApps() {
    setBusy(`Preparing ${selected.size} applications (tailoring + liveness)…`); setMsg('');
    const r = await window.api.apply.prepareBatch([...selected]);
    setBusy(''); setPrepared(r.items);
  }
  function fillSummary(r: any): string {
    if (r.assessment) return 'assessment detected — complete it in the window';
    let m = `auto-filled ${r.filled ?? 0} fields, ${r.skipped ?? 0} left for you${r.fileUploaded ? ' · résumé uploaded' : ''}`;
    if (r.submitted) m += ' · submitted ✓';
    return m;
  }
  async function applyItem(it: any) {
    setPrepared(p => p!.map(x => x.jobId === it.jobId ? { ...x, applying: true, submitErr: undefined } : x));
    const r = await window.api.apply.apply(it.jobId);
    setPrepared(p => p!.map(x => x.jobId === it.jobId
      ? (r.ok ? { ...x, applied: true, applying: false, fillMsg: fillSummary(r) } : { ...x, applying: false, submitErr: r.reason || r.error })
      : x));
  }
  async function applyAll() {
    const eligible = (prepared || []).filter(it => !it.blocked && !it.error && it.live && !it.applied);
    if (!eligible.length) return;
    const ids = new Set(eligible.map(e => e.jobId));
    setPrepared(p => p!.map(x => ids.has(x.jobId) ? { ...x, applying: true, submitErr: undefined } : x));
    const r = await window.api.apply.applyBatch([...ids]);
    setPrepared(p => p!.map(x => {
      const res = r.results.find(z => z.jobId === x.jobId);
      if (!res) return x;
      return res.ok ? { ...x, applied: true, applying: false, fillMsg: fillSummary(res) } : { ...x, applying: false, submitErr: res.reason };
    }));
  }
  async function block(company: string) {
    await window.api.blocklist.add(company);
    toast(`Blocked ${company} — future scans will skip it.`, 'success');
  }
  async function watchCompany(company: string) {
    await window.api.watch.add(company);
    toast(`Watching ${company} for new postings.`, 'success');
  }
  async function estSalary(id: number) {
    setSal(s => ({ ...s, [id]: { busy: true } }));
    const r = await window.api.intel.salary(id);
    setSal(s => ({ ...s, [id]: r }));
  }
  const fmtK = (n: number | null) => (n ? `$${Math.round(n / 1000)}k` : '?');

  return (
    <div className="panel" style={{ maxWidth: 1000 }}>
      <h1>Search &amp; Discover</h1>

      <div className="row">
        <button className="primary" onClick={openIndeed} title="Opens indeed.com with these filters — the paired extension harvests results automatically">Search Indeed ↗</button>
        <button className="primary" onClick={discover} disabled={!!busy}>Discover best fits ✨</button>
        <button className="primary" onClick={embed} disabled={!!busy}>Embed jobs + experience</button>
        <button className="primary" onClick={geocodeJobs} disabled={!!busy}>Geocode job locations</button>
        {busy && <span className="muted small">{busy}</span>}
      </div>

      {roleFits.length > 0 && (
        <div className="chips" style={{ marginTop: 4 }}>
          <span className="muted small" style={{ alignSelf: 'center' }}>Role families:</span>
          <button className={`chip ${roleFamily === '' ? 'chip-on' : ''}`} onClick={() => setRoleFamily('')}>any</button>
          {roleFits.slice(0, 10).map((r, i) => (
            <button key={i} className={`chip ${roleFamily === r.role_family ? 'chip-on' : ''}`}
              onClick={() => setRoleFamily(r.role_family)}>{r.role_family}</button>
          ))}
        </div>
      )}

      <div className="savedrow">
        <span className="muted small">Saved:</span>
        {saved.length === 0 && <span className="muted small">none</span>}
        {saved.map(s => (
          <span key={s.id} className="chip" onClick={() => loadParams(s.params)} title="run">
            {s.name} <b onClick={async e => { e.stopPropagation(); await window.api.searches.delete(s.id); setSaved(await window.api.searches.list()); }}>×</b>
          </span>
        ))}
        <button className="link" onClick={saveSearch}>+ save current</button>
      </div>
      {history.length > 0 && (
        <div className="savedrow">
          <span className="muted small">Recent:</span>
          {history.slice(0, 6).map(h => {
            const p = h.params;
            const lbl = [p.tags, p.roleFamily, p.keyword, p.locText, (p.workModes || []).join('/')]
              .map((x: any) => String(x ?? '').trim()).filter(Boolean).join(' · ') || 'all jobs';
            return <span key={h.id} className="chip" title={lbl} onClick={() => loadParams(p)}>{lbl.slice(0, 34)}</span>;
          })}
        </div>
      )}

      <div className="searchgrid">
        <input placeholder="tags (comma-separated, semantic)" value={tags} onChange={e => setTags(e.target.value)} />
        <input placeholder="keyword (exact match)" value={keyword} onChange={e => setKeyword(e.target.value)} />
        <input placeholder="min pay ($/yr)" value={payMin} onChange={e => setPayMin(e.target.value)} />
        <select value={sort} onChange={e => setSort(e.target.value as any)}>
          <option value="fit">sort: fit</option>
          <option value="pay">sort: pay</option>
          <option value="distance">sort: distance</option>
          <option value="date">sort: newest</option>
        </select>
      </div>

      <div className="locrow">
        <input placeholder="location: city / state / country / area code / address" value={locText} onChange={e => setLocText(e.target.value)} />
        <button className="primary" onClick={resolveLoc} disabled={!!busy}>Resolve</button>
        <input className="radius" placeholder="mi" value={radius} onChange={e => setRadius(e.target.value)} />
        <span className="muted small">mi radius</span>
        {loc && <button className="link" onClick={saveHome}>save as home</button>}
      </div>

      <div className="row">
        {MODES.map(m => (
          <label key={m} className="modechk">
            <input type="checkbox" checked={modes.includes(m)} onChange={() => toggleMode(m)} /> {m}
          </label>
        ))}
        <button className="primary" onClick={runSearch} disabled={!!busy}>Search</button>
      </div>

      {coverage && <p className="muted small">Embedded: {coverage.jobs}/{coverage.jobsTotal} jobs · {coverage.items} line items{loc ? ` · near ${loc.label}` : ''}</p>}
      {msg && <p className="muted small">{msg}</p>}

      {selected.size > 0 && (
        <div className="bulkbar">
          <span>{selected.size} selected</span>
          <button className="primary" onClick={prepareApps} disabled={!!busy}>Prepare applications →</button>
          <button className="link" onClick={() => setSelected(new Set())}>clear</button>
        </div>
      )}

      <table className="jobs">
        <thead><tr><th></th><th>★</th><th>Fit</th><th>Title</th><th>Company</th><th>Mode</th><th>Dist</th><th>Pay</th><th></th></tr></thead>
        <tbody>
          {rows.map(j => (
            <tr key={j.id} className={j.surfaced ? 'surfaced' : ''}>
              <td><input type="checkbox" checked={selected.has(j.id)} onChange={() => toggleSelect(j.id)} /></td>
              <td><button className="star" aria-label={j.starred ? 'Unstar job' : 'Star job'} onClick={() => star(j)}>{j.starred ? '★' : '☆'}</button></td>
              <td title={`sim ${(j.sim ?? 0).toFixed(3)}`}>
                <b>{grades[j.id]?.grade ?? j.fit_grade ?? '—'}</b>
                {typeof j.sim === 'number' && j.sim > 0 && <span className="muted small"> {Math.round(j.sim * 100)}%</span>}
              </td>
              <td>
                <a href={j.url} target="_blank" rel="noreferrer">{j.title}</a>
                {j.surfaced ? <span className="badge">surfaced</span> : null}
                {grades[j.id]?.rationale && <div className="muted small">{grades[j.id].rationale}</div>}
                {docs[j.id]?.summary && <div className="muted small">📄 {docs[j.id].summary}</div>}
                {docs[j.id]?.error && <div className="muted small">⚠️ {docs[j.id].error}</div>}
              </td>
              <td>{j.company}</td>
              <td>{j.work_mode || '—'}</td>
              <td className="muted small">{j.work_mode === 'remote' ? '—' : (j.distance != null ? `${Math.round(j.distance)}mi` : '?')}</td>
              <td>
                {j.pay ? `$${(j.pay / 1000).toFixed(0)}k` : (j.salary_listed || '—')}
                {sal[j.id] && !sal[j.id].busy && !sal[j.id].error && (
                  <div className="muted small" title="Range is an LLM estimate; BLS figure is the real national median for this occupation (OEWS)">
                    est {fmtK(sal[j.id].min)}–{fmtK(sal[j.id].max)} ({sal[j.id].confidence}, LLM est.)
                    {sal[j.id].blsMedian && <> · BLS median {fmtK(sal[j.id].blsMedian)}{sal[j.id].blsYear ? ` ('${String(sal[j.id].blsYear).slice(2)})` : ''}</>}
                  </div>
                )}
              </td>
              <td className="rowacts">
                <button className="link" onClick={() => grade(j.id)}>grade</button>
                <button className="link" onClick={() => estSalary(j.id)}>{sal[j.id]?.busy ? '…' : '$est'}</button>
                <button className="link" onClick={() => tailor(j.id)}>{docs[j.id]?.busy ? '…' : 'tailor'}</button>
                {docs[j.id]?.cv && <button className="link" onClick={() => openPath(docs[j.id].cv)}>CV</button>}
                {docs[j.id]?.cover && <button className="link" onClick={() => openPath(docs[j.id].cover)}>cover</button>}
                <button className="link" onClick={() => block(j.company)}>block</button>
                <button className="link" onClick={() => watchCompany(j.company)}>watch</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !busy && <p className="muted">Run a search or “Discover”. (Scan jobs in Dashboard + add experience first.)</p>}

      {prepared && (
        <div className="profile-card" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Review queue ({prepared.length})</h2>
            <button className="primary" onClick={applyAll}>Apply all (opens each in its own window)</button>
          </div>
          <p className="muted small">Tailored + liveness-checked. “Apply” opens the posting in a real browser window, auto-fills known fields (profile + remembered answers, EEO → decline) and uploads your résumé. Personality/aptitude assessments are left for you. With auto-submit on (Settings), it clicks Submit only when nothing required is empty.</p>
          <table className="jobs">
            <thead><tr><th>Job</th><th>Route</th><th>Live</th><th>Docs</th><th></th></tr></thead>
            <tbody>
              {prepared.map(it => (
                <tr key={it.jobId}>
                  <td>{it.title} <span className="muted small">— {it.company}</span>
                    {it.blocked && <div className="muted small">⛔ blocklisted</div>}
                    {it.error && <div className="muted small">⚠️ {it.error}</div>}
                    {it.submitErr && <div className="muted small">⚠️ {it.submitErr}</div>}
                    {it.fillMsg && <div className="muted small">✓ {it.fillMsg}</div>}</td>
                  <td className="muted small">{it.route || '—'}</td>
                  <td className="muted small">{it.blocked || it.error ? '—' : (it.live ? 'live' : `✗ ${it.liveReason}`)}</td>
                  <td>{it.cv && <><button className="link" onClick={() => openPath(it.cv)}>CV</button> <button className="link" onClick={() => openPath(it.cover)}>cover</button></>}</td>
                  <td>{it.applied ? <span className="muted small">✓ applied</span>
                    : (!it.blocked && !it.error && it.live) ? <button className="primary" onClick={() => applyItem(it)} disabled={it.applying}>{it.applying ? '…' : 'Apply'}</button>
                    : <span className="muted small">skip</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="link" onClick={() => setPrepared(null)}>close queue</button>
        </div>
      )}
    </div>
  );
}
