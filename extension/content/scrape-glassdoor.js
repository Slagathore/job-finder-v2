// Glassdoor jobs scraper (best-effort; selectors drift — tune after recon).
function jfText(el, sel) { const n = el.querySelector(sel); return n ? (n.getAttribute('title') || n.textContent || '').trim() : ''; }

function scrapeGlassdoor() {
  const cards = Array.from(document.querySelectorAll('li.react-job-listing, [data-test="jobListing"], article[data-id], .job-listing-item, [data-brandviews]'));
  const out = [];
  for (const c of cards) {
    const titleEl = c.querySelector('[data-test="job-link"], .job-title a, [class*="jobTitle"] a, a[class*="JobLink"], a[data-test="job-title"]');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    const company = jfText(c, '.employer-name') || jfText(c, '[data-test="employer-name"]') || jfText(c, '[class*="EmployerName"]');
    const location = jfText(c, '[data-test="location"]') || jfText(c, '[class*="Location"]') || jfText(c, '.location');
    let url = titleEl ? titleEl.getAttribute('href') : '';
    if (!url) { const a = c.querySelector('a[href]'); url = a ? a.getAttribute('href') : ''; }
    if (url && !url.startsWith('http')) url = 'https://www.glassdoor.com' + url;
    if (!title || !url) continue;
    out.push({ title, company, location, url, source: 'glassdoor-ext' });
  }
  return out;
}

chrome.runtime.onMessage.addListener((m, _s, resp) => { if (m.cmd === 'harvest') { resp({ jobs: scrapeGlassdoor() }); return true; } });
setTimeout(async () => { const { autoHarvest } = await chrome.storage.local.get('autoHarvest'); if (!autoHarvest) return; const jobs = scrapeGlassdoor(); if (jobs.length) chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs }); }, 1800);
