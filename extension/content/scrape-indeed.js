// Indeed results-page scraper. Selectors mirror career-ops/search.mjs (the most
// stable Indeed markers) with fallbacks. Runs in Cole's real session — no
// headless flag, so anti-bot doesn't trip.

function jfText(el, sel) {
  const n = el.querySelector(sel);
  if (!n) return '';
  return (n.getAttribute('title') || n.textContent || '').trim();
}

function scrapeIndeed() {
  const cards = Array.from(document.querySelectorAll('[data-jk]'));
  const out = [];
  for (const c of cards) {
    const jk = c.getAttribute('data-jk');
    if (!jk) continue;
    const title =
      jfText(c, '.jobTitle span[title]') || jfText(c, '.jobTitle a span') ||
      jfText(c, '[data-testid="job-title"]') || jfText(c, 'h2.jobTitle span') || jfText(c, '.jobTitle');
    const company = jfText(c, '[data-testid="company-name"]') || jfText(c, '.companyName');
    const location = jfText(c, '[data-testid="text-location"]') || jfText(c, '.companyLocation');
    if (!title) continue;
    out.push({ title, company, location, url: 'https://www.indeed.com/viewjob?jk=' + jk, source: 'indeed-ext' });
  }
  return out;
}

chrome.runtime.onMessage.addListener((m, _s, resp) => {
  if (m.cmd === 'harvest') { resp({ jobs: scrapeIndeed() }); return true; }
});

// Auto-harvest each results page when enabled (handles pagination naturally:
// the user clicks through pages, each reload re-fires this).
setTimeout(async () => {
  const { autoHarvest } = await chrome.storage.local.get('autoHarvest');
  if (!autoHarvest) return;
  const jobs = scrapeIndeed();
  if (jobs.length) chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs });
}, 1800);
