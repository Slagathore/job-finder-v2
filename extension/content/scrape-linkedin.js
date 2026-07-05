// LinkedIn jobs scraper (best-effort; selectors drift — tune after recon).
function jfText(el, sel) { const n = el.querySelector(sel); return n ? (n.getAttribute('title') || n.textContent || '').trim() : ''; }

function scrapeLinkedIn() {
  const cards = Array.from(document.querySelectorAll('.job-card-container, .jobs-search__results-list li, .base-card, [data-job-id]'));
  const out = [];
  for (const c of cards) {
    const title = jfText(c, '.job-card-list__title') || jfText(c, '.base-search-card__title') || jfText(c, 'a.job-card-container__link') || jfText(c, '.job-card-list__title--link');
    const company = jfText(c, '.job-card-container__company-name') || jfText(c, '.base-search-card__subtitle') || jfText(c, '.job-card-container__primary-description');
    const location = jfText(c, '.job-card-container__metadata-item') || jfText(c, '.job-search-card__location');
    const a = c.querySelector('a[href*="/jobs/view/"], a.base-card__full-link, a.job-card-container__link');
    let url = a ? a.getAttribute('href') : '';
    if (url && !url.startsWith('http')) url = 'https://www.linkedin.com' + url;
    if (!title || !url) continue;
    out.push({ title, company, location, url: url.split('?')[0], source: 'linkedin-ext' });
  }
  return out;
}

chrome.runtime.onMessage.addListener((m, _s, resp) => { if (m.cmd === 'harvest') { resp({ jobs: scrapeLinkedIn() }); return true; } });
setTimeout(async () => { const { autoHarvest } = await chrome.storage.local.get('autoHarvest'); if (!autoHarvest) return; const jobs = scrapeLinkedIn(); if (jobs.length) chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs }); }, 1800);
