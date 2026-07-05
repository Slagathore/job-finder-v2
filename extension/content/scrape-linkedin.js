// LinkedIn jobs scraper: results-page cards + job detail-page description
// capture + auto-harvest + stale reporting (best-effort; selectors drift —
// tune after recon). LinkedIn is a SPA, so a lightweight URL-change watcher
// re-triggers auto-harvest when navigation doesn't reload the page.
function jfText(el, sel) { const n = el.querySelector(sel); return n ? (n.getAttribute('title') || n.textContent || '').trim() : ''; }

const jfIsResultsPage = () => /^\/jobs\/(search|collections)/.test(location.pathname);
const jfIsViewJob = () => /^\/jobs\/view\//.test(location.pathname);

function jfViewJobId() {
  const m = location.pathname.match(/\/jobs\/view\/(\d+)/);
  return m ? m[1] : '';
}

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

// Detail page: builds the same canonical URL the card scraper produces after
// .split('?')[0] (https://www.linkedin.com/jobs/view/<id>), so the hub
// enriches the existing row with the full description instead of duplicating.
function scrapeViewJob() {
  const id = jfViewJobId();
  if (!id) return null;
  const q = (sel) => { const n = document.querySelector(sel); return n ? (n.textContent || '').trim() : ''; };
  const title =
    q('h1.top-card-layout__title') || q('h1.t-24') ||
    q('.job-details-jobs-unified-top-card__job-title h1') || q('h1');
  if (!title) return null;
  const company =
    q('.topcard__org-name-link') || q('.job-details-jobs-unified-top-card__company-name a') ||
    q('.job-details-jobs-unified-top-card__company-name') || q('[data-tracking-control-name="public_jobs_topcard-org-name"]');
  const location_ =
    q('.topcard__flavor--bullet') || q('.job-details-jobs-unified-top-card__primary-description-container span:first-child') ||
    q('.top-card-layout__second-subline span');
  const descEl =
    document.querySelector('#job-details') || document.querySelector('.jobs-description__content') ||
    document.querySelector('.description__text') || document.querySelector('.jobs-box__html-content');
  const description = descEl ? (descEl.innerText || '').trim().slice(0, 12000) : '';
  const salaryRaw = q('.salary') || q('[class*="salary"]');
  return {
    title, company, location: location_, description,
    salary: /\$/.test(salaryRaw) ? salaryRaw : '',
    url: 'https://www.linkedin.com/jobs/view/' + id, source: 'linkedin-ext',
  };
}

function scrapeCurrent() {
  if (jfIsViewJob()) { const j = scrapeViewJob(); return j ? [j] : []; }
  return scrapeLinkedIn();
}

chrome.runtime.onMessage.addListener((m, _s, resp) => { if (m.cmd === 'harvest') { resp({ jobs: scrapeCurrent() }); return true; } });

// Job ids already pushed this page session, so the retry loop and the
// URL-change watcher never double-push the same job.
const jfPushedIds = new Set();

// The description panel can render lazily after navigation, so retry a few
// times before giving up on this job id. Bails early if the tab has already
// navigated to a different job (or the id was already pushed).
function jfHarvestViewJobWithRetry(id) {
  [0, 1500, 3000].forEach((delay) => {
    setTimeout(() => {
      if (jfPushedIds.has(id) || jfViewJobId() !== id) return;
      const job = scrapeViewJob();
      if (job && job.description) {
        jfPushedIds.add(id);
        chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs: [job] });
      }
    }, delay);
  });
}

async function jfAutoHarvestTick() {
  const { autoHarvest } = await chrome.storage.local.get('autoHarvest');
  if (!autoHarvest) return;

  if (jfIsViewJob()) {
    jfHarvestViewJobWithRetry(jfViewJobId());
    return;
  }
  if (!jfIsResultsPage()) return;

  const jobs = scrapeLinkedIn();
  if (jobs.length) chrome.runtime.sendMessage({ cmd: 'pushJobs', jobs });
  // Only a jobs-search page with zero cards means the selectors are stale —
  // this script runs on all of linkedin.com (feed, profiles, …).
  else chrome.runtime.sendMessage({ cmd: 'scraperStale', site: 'linkedin', url: location.href });
}

setTimeout(jfAutoHarvestTick, 1800);

// LinkedIn is a SPA: navigating from search into a job view (or from one job
// to the next) usually doesn't reload the page, so the one-shot timer above
// won't re-fire. Poll the URL and re-run the same auto-harvest logic whenever
// it changes — jfHarvestViewJobWithRetry's own id checks keep this idempotent.
let jfLastHref = location.href;
setInterval(() => {
  if (location.href === jfLastHref) return;
  jfLastHref = location.href;
  jfAutoHarvestTick();
}, 1500);
