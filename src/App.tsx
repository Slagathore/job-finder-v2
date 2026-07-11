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

  const silence = (mode: 'until-next' | 'forever') => {
    window.api.update.silence(mode).catch(() => {});
    setUpdate(null);
  };

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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Job&nbsp;Finder<span className="ver">v{version}</span></div>
        <nav>
          {TABS.map(t => (
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
                : <><strong>Update available</strong> — {update.summary}</>}
            </span>
            <span className="update-actions">
              <button className="update-get" onClick={() => window.api.app.openExternal(update.repoUrl)}>
                Get update
              </button>
              {!update.emergency && (
                <>
                  <button onClick={() => silence('until-next')}>Silence until next update</button>
                  <button onClick={() => silence('forever')}>Don't show again</button>
                </>
              )}
              <button title={update.emergency ? 'Hide for this session (shows again next launch)' : 'Hide for now'}
                onClick={() => setUpdate(null)}>✕</button>
            </span>
          </div>
        )}
        {/* Tabs lazy-mount on first visit, then stay mounted (hidden) so
            in-progress state — agent chats, search results, scan summaries —
            survives tab switches. Each tab gets its own boundary so a crash
            is isolated and retryable without nuking the others' state. */}
        {TABS.map(t => visited.includes(t.id) && (
          <div key={t.id} style={t.id === tab ? undefined : { display: 'none' }}>
            <ErrorBoundary>{renderTab(t.id)}</ErrorBoundary>
          </div>
        ))}
      </main>
      <FeedbackHost />
    </div>
  );
}
