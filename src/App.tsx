import React, { useEffect, useRef, useState } from 'react';
import { HealthBadge } from './components/HealthBadge';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FirstRunWizard } from './components/FirstRunWizard';
import { celebrate } from './lib/celebrate';
import { FeedbackHost, toast } from './lib/feedback';
import { Dashboard } from './tabs/Dashboard';
import { SettingsTab } from './tabs/SettingsTab';
import { BoardsTab } from './tabs/BoardsTab';
import { ExperienceTab } from './tabs/ExperienceTab';
import { SearchTab } from './tabs/SearchTab';
import { AgentTab } from './tabs/AgentTab';
import { SelfExtendTab } from './tabs/SelfExtendTab';
import { PipelineTab } from './tabs/PipelineTab';
import { CareerTab } from './tabs/CareerTab';

type TabId = 'dashboard' | 'search' | 'pipeline' | 'experience' | 'boards' | 'career' | 'agent' | 'selfext' | 'settings';

const KOFI_URL = 'https://ko-fi.com/sparklemuffin';

const TABS: { id: TabId; label: string; phase?: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'search', label: 'Search' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'experience', label: 'Experience' },
  { id: 'boards', label: 'Boards' },
  { id: 'career', label: 'Career' },
  { id: 'agent', label: 'Agent' },
  { id: 'selfext', label: 'Self-extend' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [visited, setVisited] = useState<TabId[]>(['dashboard']);
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<Awaited<ReturnType<typeof window.api.update.check>>>(null);
  const [installing, setInstalling] = useState(false);
  const [installPct, setInstallPct] = useState(0);
  const [installMsg, setInstallMsg] = useState('');
  const [installErr, setInstallErr] = useState('');
  const [selfExtend, setSelfExtend] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const lastCelebrated = useRef<number>(-1);

  useEffect(() => { setVisited(v => v.includes(tab) ? v : [...v, tab]); }, [tab]);

  function renderTab(id: TabId): React.ReactNode {
    switch (id) {
      case 'dashboard': return <Dashboard />;
      case 'settings': return <SettingsTab />;
      case 'search': return <SearchTab />;
      case 'pipeline': return <PipelineTab />;
      case 'experience': return <ExperienceTab />;
      case 'boards': return <BoardsTab />;
      case 'career': return <CareerTab />;
      case 'agent': return <AgentTab onOpenTab={(t) => setTab(t as TabId)} />;
      case 'selfext': return <SelfExtendTab />;
    }
  }

  useEffect(() => { window.api.app.version().then(setVersion); }, []);

  // First-run wizard: fresh profile = never onboarded and no contact set.
  useEffect(() => {
    window.api.settings.get()
      .then(s => { if (!s.onboarded && !s.candidateName) setShowWizard(true); })
      .catch(() => {});
  }, []);

  // On-load update scan. Emergencies come back even when silenced.
  useEffect(() => { window.api.update.check().then(setUpdate).catch(() => {}); }, []);

  // Self-extend is hidden where it cannot work (a packaged install ships no
  // sources or toolchain, so its sandbox gate could never pass).
  useEffect(() => {
    window.api.app.capabilities()
      .then(c => setSelfExtend(!!c.selfExtend))
      .catch(() => setSelfExtend(false));
  }, []);

  // Download progress + any failure the updater reports after the click.
  useEffect(() => window.api.update.onProgress(p => setInstallPct(Math.round(p.percent))), []);
  useEffect(() => window.api.update.onError(m => { setInstalling(false); setInstallMsg(''); setInstallErr(m); }), []);

  const silence = (mode: 'until-next' | 'forever') => {
    window.api.update.silence(mode).catch(() => {});
    setUpdate(null);
  };

  // "Get update" used to open a browser and call it done. Now it downloads the
  // signed installer, lets the updater verify it (checksum + Authenticode
  // publisher), and quits into it. Success is only ever claimed once the
  // installer has actually been handed off.
  async function installUpdate() {
    setInstalling(true); setInstallErr(''); setInstallPct(0);
    setInstallMsg('Downloading update…');
    try {
      const r = await window.api.update.install();
      if (r.ok) {
        setInstallMsg('Update verified. Closing Job Finder to run the installer…');
      } else {
        setInstalling(false);
        setInstallMsg('');
        setInstallErr(r.error ?? 'Update failed, nothing was installed.');
      }
    } catch (e: any) {
      setInstalling(false);
      setInstallMsg('');
      setInstallErr(String(e?.message ?? e));
    }
  }

  // Tray items and desktop-notification clicks deep-link into a tab.
  useEffect(() => window.api.app.onOpenTab(t => setTab(t as TabId)), []);

  useEffect(() => {
    function onRejection(e: PromiseRejectionEvent) {
      toast(String((e.reason && e.reason.message) ?? e.reason), 'error');
    }
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  // Confetti + chime when an email is classified interview/offer.
  useEffect(() => {
    let init = true;
    async function check() {
      const list = await window.api.notifications.list();
      const hit = list.find((n: any) => n.kind === 'email' && ['interview', 'offer'].includes(n.payload?.classification));
      if (!hit) return;
      if (init) { lastCelebrated.current = hit.id; init = false; return; } // don't fire on first load
      if (hit.id > lastCelebrated.current) { lastCelebrated.current = hit.id; celebrate(); }
    }
    check();
    const off = window.api.notifications.onNotify(() => check());
    return () => off();
  }, []);

  const tabs = TABS.filter(t => t.id !== 'selfext' || selfExtend);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Job&nbsp;Finder<span className="ver">v{version}</span></div>
        <nav>
          {tabs.map(t => (
            <button
              key={t.id}
              className={`navbtn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.phase && <span className="soon">{t.phase}</span>}
            </button>
          ))}
        </nav>
        <div className="donate-box">
          If this helped you, consider donating to help keep me focused on making more useful free apps? Thanks!
          <button className="donate-btn" onClick={() => window.api.app.openExternal(KOFI_URL)}>
            ☕ Donate on Ko-fi
          </button>
        </div>
        <div className="sidebar-foot"><HealthBadge /></div>
      </aside>

      {showWizard && <FirstRunWizard onDone={() => setShowWizard(false)} />}
      <main className="content">
        {update && (
          <div className={`update-banner ${update.emergency ? 'urgent' : ''}`}>
            <span className="update-text">
              {update.emergency
                ? <><strong>⚠ Critical update:</strong> {update.emergencyMessage}</>
                : <><strong>Update available</strong> — v{update.latestVersion} · {update.summary}</>}
            </span>
            <span className="update-actions">
              {update.canInstall ? (
                <button className="update-get" onClick={installUpdate} disabled={installing}>
                  {installing ? (installPct > 0 ? `Downloading ${installPct}%` : 'Downloading…') : 'Download & install'}
                </button>
              ) : (
                <button className="update-get" title={update.installBlockedReason}
                  onClick={() => window.api.app.openExternal(update.repoUrl)}>
                  Open releases page
                </button>
              )}
              {!update.emergency && !installing && (
                <>
                  <button onClick={() => silence('until-next')}>Silence until next update</button>
                  <button onClick={() => silence('forever')}>Don't show again</button>
                </>
              )}
              {!installing && (
                <button title={update.emergency ? 'Hide for this session (shows again next launch)' : 'Hide for now'}
                  onClick={() => setUpdate(null)}>✕</button>
              )}
            </span>
            {(installMsg || installErr || !update.canInstall) && (
              <span className="update-status">
                {installErr
                  ? <span className="msg-error">⚠️ {installErr}</span>
                  : installMsg
                    ? <span className="muted small">{installMsg}</span>
                    : <span className="muted small">{update.installBlockedReason}</span>}
              </span>
            )}
          </div>
        )}
        {/* Tabs lazy-mount on first visit, then stay mounted (hidden) so
            in-progress state — agent chats, search results, scan summaries —
            survives tab switches. Each tab gets its own boundary so a crash
            is isolated and retryable without nuking the others' state. */}
        {tabs.map(t => visited.includes(t.id) && (
          <div key={t.id} style={t.id === tab ? undefined : { display: 'none' }}>
            <ErrorBoundary>{renderTab(t.id)}</ErrorBoundary>
          </div>
        ))}
      </main>
      <FeedbackHost />
    </div>
  );
}
