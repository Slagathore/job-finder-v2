// ZipRecruiter jobs scraper (best-effort; selectors drift — tune after recon).
function jfText(el, sel) { const n = el.querySelector(sel); return n ? (n.getAttribute('title') || n.textContent || '').trim() : ''; }

function scrapeZip() {
  const cards = Array.from(document.querySelectorAll('article.job_result, .job_content, [class*="job-card"], li[class*="JobListItem"], [class*="job_result"]'));
  const out = [];
  for (const c of cards) {
    const titleEl = c.querySelector('h2 a, .job_title a, [class*="jobTitle"] a, a[data-job-title], [class*="JobTitle"] a, a.job_link');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    const company = jfText(c, '.hiring_company_text') || jfText(c, '[class*="company"]') || jfText(c, '[class*="Company"]');
    const location = jfText(c, '.location_text') || jfText(c, '[class*="location"]') || jfText(c, '[class*="Location"]');
    let url = titleEl ? titleEl.getAttribute('href') : '';
    if (url && !url.startsWith('http')) url = 'https://www.ziprecruiter.com' + url;
    if (!title || !url) continue;
    out.push({ title, company, location, url: url.split('?')[0], source: 'ziprecruiter-ext' });
  }
  return out;
}

chrome.runtime.onMessage.addListener((m, _s, resp) => { if (m.cmd === 'harvest') { resp({ jobs: scrapeZip() }); return true; } });
setTimeout(async () => { const { autoHarvest } = await chrome.storage.local.get('autoHarvest'); if (!autoHarvest) return; const jobs = scrapeZip(); if (jobs.length) chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs }); }, 1800);
