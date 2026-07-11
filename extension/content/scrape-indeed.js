// Indeed scraper: results pages (cards) + job detail pages (full description +
// salary). Selectors mirror career-ops/search.mjs (the most stable Indeed
// markers) with fallbacks. Runs in Cole's real session — no headless flag, so
// anti-bot doesn't trip.

function jfText(el, sel) {
  const n = el.querySelector(sel);
  if (!n) return '';
  return (n.getAttribute('title') || n.textContent || '').trim();
}

const jfIsResultsPage = () => /^\/(jobs|q-)/.test(location.pathname);
const jfIsViewJob = () => location.pathname.startsWith('/viewjob');

function scrapeIndeedCards() {
  const cards = Array.from(document.querySelectorAll('[data-jk]'));
  const out = [];
  for (const c of cards) {
    const jk = c.getAttribute('data-jk');
    if (!jk) continue;
    const title =
      jfText(c, '.jobTitle span[title]') || jfText(c, '.jobTitle a span') ||
      jfText(c, '[data-testid="job-title"]') || jfText(c, 'h2.jobTitle span') || jfText(c, '.jobTitle');
    const company = jfText(c, '[data-testid="company-name"]') || jfText(c, '.companyName');
    const location_ = jfText(c, '[data-testid="text-location"]') || jfText(c, '.companyLocation');
    const salaryRaw =
      jfText(c, '[data-testid="attribute_snippet_testid"]') || jfText(c, '.salary-snippet-container') ||
      jfText(c, '.estimated-salary') || jfText(c, '[class*="salary"]');
    if (!title) continue;
    out.push({
      title, company, location: location_,
      salary: /\$/.test(salaryRaw) ? salaryRaw : '',
      url: 'https://www.indeed.com/viewjob?jk=' + jk, source: 'indeed-ext',
    });
  }
  return out;
}

// Detail page: same normalized URL as the card (viewjob?jk=), so the hub
// enriches the existing row with description + salary instead of duplicating.
function scrapeViewJob() {
  const jk = new URLSearchParams(location.search).get('jk');
  if (!jk) return null;
  const q = (sel) => { const n = document.querySelector(sel); return n ? (n.textContent || '').trim() : ''; };
  const title =
    q('h1[data-testid="jobsearch-JobInfoHeader-title"]') || q('.jobsearch-JobInfoHeader-title') ||
    q('h1[class*="jobsearch"]') || q('h1');
  if (!title) return null;
  const company =
    q('[data-testid="inlineHeader-companyName"]') || q('[data-company-name]') ||
    q('.jobsearch-CompanyInfoContainer a') || q('[data-testid="jobsearch-CompanyInfoContainer"] a');
  const location_ =
    q('[data-testid="inlineHeader-companyLocation"]') || q('[data-testid="job-location"]') ||
    q('.jobsearch-JobInfoHeader-subtitle > div:last-child');
  const descEl = document.querySelector('#jobDescriptionText') || document.querySelector('[data-testid="jobDescriptionText"]');
  const description = descEl ? (descEl.innerText || '').trim().slice(0, 12000) : '';
  const salaryRaw = q('#salaryInfoAndJobType') || q('[data-testid="jobsearch-OtherJobDetailsContainer"]');
  return {
    title: title.replace(/\s*-\s*job post$/i, ''), company, location: location_,
    description, salary: /\$/.test(salaryRaw) ? salaryRaw : '',
    url: 'https://www.indeed.com/viewjob?jk=' + jk, source: 'indeed-ext',
  };
}

function scrapeCurrent() {
  if (jfIsViewJob()) { const j = scrapeViewJob(); return j ? [j] : []; }
  return scrapeIndeedCards();
}

chrome.runtime.onMessage.addListener((m, _s, resp) => {
  if (m.cmd === 'harvest') { resp({ jobs: scrapeCurrent() }); return true; }
});

// Per-tab pagination counter, keyed by query so a new search resets the count.
function jfPageCount(q) {
  try {
    const st = JSON.parse(sessionStorage.getItem('jfAutoPage') || 'null');
    return st && st.q === q ? st.page : 1;
  } catch { return 1; }
}
function jfSetPageCount(q, page) {
  try { sessionStorage.setItem('jfAutoPage', JSON.stringify({ q, page })); } catch { /* */ }
}

// Auto-harvest when enabled: results pages push their cards, detail pages push
// the full description. On results pages it then walks pagination itself
// (capped, human-ish delay) — no more clicking "next" per page.
setTimeout(async () => {
  const cfg = await chrome.storage.local.get(['autoHarvest', 'autoPaginate', 'maxPages']);
  if (!cfg.autoHarvest) return;

  if (jfIsViewJob()) {
    const job = scrapeViewJob();
    if (job && job.description) chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs: [job] });
    return;
  }
  if (!jfIsResultsPage()) return;

  const jobs = scrapeIndeedCards();
  const query = new URLSearchParams(location.search).get('q') || '';
  if (jobs.length) {
    // Stop paginating when the hub isn't accepting — walking 20 pages into a
    // dead hub wastes navigation (and anti-bot budget) for zero data.
    const push = await chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs }).catch(() => null);
    if (!push || !push.ok) return;
  } else if (query) {
    // A real search with zero recognizable cards = selectors likely stale.
    chrome.runtime.sendMessage({ cmd: 'scraperStale', site: 'indeed', url: location.href });
    return;
  }

  if (cfg.autoPaginate === false) return; // default ON while auto-harvest is on
  const max = Math.max(1, Number(cfg.maxPages) || 5);
  const page = jfPageCount(query);
  if (page >= max) return;
  const next = document.querySelector('a[data-testid="pagination-page-next"]') ||
               document.querySelector('a[aria-label="Next Page"]') ||
               document.querySelector('a[aria-label="Next"]');
  if (!next) return;
  jfSetPageCount(query, page + 1);
  setTimeout(() => next.click(), 2500 + Math.random() * 2500);
}, 1800);
