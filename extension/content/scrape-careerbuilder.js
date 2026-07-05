// CareerBuilder results-page scraper. CB's markup is less documented than
// Indeed's, so these selectors are best-effort with several fallbacks — expect
// to tune them after a recon pass on a live results page (PLAN.md §11).

function jfText(el, sel) {
  const n = el.querySelector(sel);
  if (!n) return '';
  return (n.getAttribute('title') || n.textContent || '').trim();
}
function jfAbs(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return 'https://www.careerbuilder.com' + (href.startsWith('/') ? '' : '/') + href;
}

function scrapeCareerBuilder() {
  const cards = Array.from(document.querySelectorAll(
    '.data-results-content-parent, li.data-results-content, .job-listing-item, [data-results-content], article.job'
  ));
  const out = [];
  for (const c of cards) {
    const title = jfText(c, '.data-results-title') || jfText(c, '.job-title') || jfText(c, 'h2 a') || jfText(c, 'a[data-results-title]');
    const company = jfText(c, '.data-details > span:nth-child(1)') || jfText(c, '.company-name') || jfText(c, '[data-company]');
    const location = jfText(c, '.data-details > span:nth-child(2)') || jfText(c, '.location') || jfText(c, '[data-location]');
    const a = c.querySelector('a[href*="/job/"]') || c.querySelector('a[href]');
    const url = jfAbs(a ? a.getAttribute('href') : '');
    if (!title || !url) continue;
    out.push({ title, company, location, url, source: 'careerbuilder-ext' });
  }
  return out;
}

chrome.runtime.onMessage.addListener((m, _s, resp) => {
  if (m.cmd === 'harvest') { resp({ jobs: scrapeCareerBuilder() }); return true; }
});

setTimeout(async () => {
  const { autoHarvest } = await chrome.storage.local.get('autoHarvest');
  if (!autoHarvest) return;
  const jobs = scrapeCareerBuilder();
  if (jobs.length) chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs });
}, 1800);
