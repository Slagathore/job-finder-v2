import React, { useEffect, useRef, useState } from 'react';
import { HealthBadge } from './components/HealthBadge';
import { ErrorBoundary } from './components/ErrorBoundary';
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
  const [version, setVersion] = useState('');
  const lastCelebrated = useRef<number>(-1);

  useEffect(() => { window.api.app.version().then(setVersion); }, []);

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
        <div className="sidebar-foot"><HealthBadge /></div>
      </aside>

      <main className="content">
        <ErrorBoundary>
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'settings' && <SettingsTab />}
          {tab === 'search' && <SearchTab />}
          {tab === 'pipeline' && <PipelineTab />}
          {tab === 'experience' && <ExperienceTab />}
          {tab === 'boards' && <BoardsTab />}
          {tab === 'career' && <CareerTab />}
          {tab === 'agent' && <AgentTab onOpenTab={(t) => setTab(t as TabId)} />}
          {tab === 'selfext' && <SelfExtendTab />}
        </ErrorBoundary>
      </main>
      <FeedbackHost />
    </div>
  );
}
