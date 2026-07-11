import React, { useEffect, useState } from 'react';

type Health = Awaited<ReturnType<Window['api']['llm']['health']>>;

export function HealthBadge() {
  const [h, setH] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    // catch: this runs on a 30s interval — a rejecting IPC must not feed the
    // global unhandledrejection toast every tick. null renders as "LLM offline".
    try { setH(await window.api.llm.health()); }
    catch { setH(null); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, []);

  const ok = h?.ollamaUp || h?.anthropicConfigured;
  const dot = loading ? 'gray' : ok ? 'green' : 'red';
  const label = loading ? 'checking…'
    : h?.ollamaUp ? `Ollama up · ${h.primaryModel}`
    : h?.anthropicConfigured ? 'Ollama down · Anthropic fallback'
    : 'LLM offline';

  return (
    <button className="health" onClick={refresh} title={h?.detail ?? ''}>
      <span className={`dot ${dot}`} />
      <span className="health-label">{label}</span>
    </button>
  );
}
