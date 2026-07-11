// Service worker: bridges content scripts / popup to the Job Finder hub's local
// HTTP ingress. Hub URL + pairing token live in chrome.storage.local.

const DEFAULT_HUB = 'http://127.0.0.1:17893';

async function getCfg() {
  const { hubUrl, token } = await chrome.storage.local.get(['hubUrl', 'token']);
  return { hubUrl: hubUrl || DEFAULT_HUB, token: token || '' };
}

async function postJSON(path, payload) {
  const { hubUrl, token } = await getCfg();
  const res = await fetch(hubUrl.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-JF-Token': token },
    body: JSON.stringify(payload),
    // A wedged hub (connected but silent) must not hang the service worker.
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('hub HTTP ' + res.status);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.cmd === 'ping') {
        const { hubUrl } = await getCfg();
        const res = await fetch(hubUrl.replace(/\/$/, '') + '/ping', { signal: AbortSignal.timeout(10000) });
        sendResponse({ ok: res.ok, data: res.ok ? await res.json() : null });
      } else if (msg.cmd === 'pushJobs') {
        sendResponse({ ok: true, data: await postJSON('/ingest/jobs', { jobs: msg.jobs || [] }) });
      } else if (msg.cmd === 'pushFields') {
        sendResponse({ ok: true, data: await postJSON('/ingest/fields', { fields: msg.fields || [] }) });
      } else if (msg.cmd === 'scraperStale') {
        sendResponse({ ok: true, data: await postJSON('/ingest/stale', { site: msg.site || 'unknown', url: msg.url || '' }) });
      } else {
        sendResponse({ ok: false, error: 'unknown command' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
