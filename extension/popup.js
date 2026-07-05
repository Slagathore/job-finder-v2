const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.storage.local.get(['hubUrl', 'token', 'autoHarvest', 'fieldCapture']);
  $('hubUrl').value = cfg.hubUrl || 'http://127.0.0.1:17893';
  $('token').value = cfg.token || '';
  $('autoHarvest').checked = !!cfg.autoHarvest;
  $('fieldCapture').checked = !!cfg.fieldCapture;
}

$('save').onclick = async () => {
  await chrome.storage.local.set({ hubUrl: $('hubUrl').value.trim(), token: $('token').value.trim() });
  $('status').textContent = 'Saved.';
};

$('test').onclick = async () => {
  await chrome.storage.local.set({ hubUrl: $('hubUrl').value.trim(), token: $('token').value.trim() });
  $('status').textContent = 'Pinging…';
  const r = await chrome.runtime.sendMessage({ cmd: 'ping' });
  $('status').textContent = r && r.ok ? '✓ Connected to ' + (r.data && r.data.app || 'hub') : '✗ ' + ((r && r.error) || 'no response — is the app running?');
};

$('harvest').onclick = async () => {
  $('harvestMsg').textContent = 'Harvesting…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let resp;
  try { resp = await chrome.tabs.sendMessage(tab.id, { cmd: 'harvest' }); }
  catch { $('harvestMsg').textContent = 'Not a supported job page (open an Indeed/CareerBuilder results page).'; return; }
  const jobs = (resp && resp.jobs) || [];
  if (!jobs.length) { $('harvestMsg').textContent = 'No job cards found on this page.'; return; }
  const push = await chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs });
  if (push && push.ok) $('harvestMsg').textContent = `Sent ${jobs.length} → +${push.data.added} new, ${push.data.duplicates} dupes.`;
  else $('harvestMsg').textContent = '✗ ' + ((push && push.error) || 'hub error');
};

$('autoHarvest').onchange = (e) => chrome.storage.local.set({ autoHarvest: e.target.checked });
$('fieldCapture').onchange = (e) => chrome.storage.local.set({ fieldCapture: e.target.checked });

load();
