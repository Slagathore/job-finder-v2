/**
 * ATS API scanner — ported from career-ops/scan.mjs to TypeScript.
 *
 * Hits Greenhouse / Ashby / Lever job-board APIs directly (pure HTTP + JSON,
 * zero LLM cost) and normalises the results. Pure + side-effect-free so the
 * detection/parsing logic can be unit-tested; persistence lives in runner.ts.
 */

export interface CompanyInput { name: string; url?: string; api?: string; }
export interface Offer {
  title: string;
  url: string;
  company: string;
  location: string;
  source: string;          // e.g. "greenhouse-api"
  workMode: string | null; // remote|hybrid|onsite|null
}
export type AtsType = 'greenhouse' | 'ashby' | 'lever';
export interface ApiTarget { type: AtsType; url: string; }

const FETCH_TIMEOUT_MS = 10_000;

const REMOTE_KEYWORDS = [
  'remote', 'work from home', 'wfh', 'anywhere', 'distributed',
  'virtual', 'telecommute', 'home-based', 'home based', 'fully remote',
];
const HYBRID_KEYWORDS = ['hybrid'];

/** Best-effort work-mode inference from a free-text location string. */
export function inferWorkMode(location: string): string | null {
  if (!location) return null;
  const l = location.toLowerCase();
  if (REMOTE_KEYWORDS.some(k => l.includes(k))) return 'remote';
  if (HYBRID_KEYWORDS.some(k => l.includes(k))) return 'hybrid';
  return null; // unknown — likely onsite, but don't assert
}

/** Map a company's careers_url / api to a concrete ATS API endpoint. */
export function detectApi(company: CompanyInput): ApiTarget | null {
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }
  const url = company.url || '';

  const ashby = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashby) {
    return { type: 'ashby', url: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}?includeCompensation=true` };
  }

  const lever = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (lever) {
    return { type: 'lever', url: `https://api.lever.co/v0/postings/${lever[1]}` };
  }

  const gh = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (gh) {
    return { type: 'greenhouse', url: `https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs` };
  }

  const ghPlain = url.match(/boards\.greenhouse\.io\/([^/?#]+)/);
  if (ghPlain) {
    return { type: 'greenhouse', url: `https://boards-api.greenhouse.io/v1/boards/${ghPlain[1]}/jobs` };
  }

  return null;
}

function rawToOffer(o: { title: string; url: string; location: string }, company: string, type: AtsType): Offer {
  return {
    title: o.title || '',
    url: o.url || '',
    company,
    location: o.location || '',
    source: `${type}-api`,
    workMode: inferWorkMode(o.location || ''),
  };
}

export function parseGreenhouse(json: any, company: string): Offer[] {
  return (json?.jobs ?? []).map((j: any) =>
    rawToOffer({ title: j.title, url: j.absolute_url, location: j.location?.name ?? '' }, company, 'greenhouse'));
}
export function parseAshby(json: any, company: string): Offer[] {
  return (json?.jobs ?? []).map((j: any) =>
    rawToOffer({ title: j.title, url: j.jobUrl, location: j.location ?? '' }, company, 'ashby'));
}
export function parseLever(json: any, company: string): Offer[] {
  if (!Array.isArray(json)) return [];
  return json.map((j: any) =>
    rawToOffer({ title: j.text, url: j.hostedUrl, location: j.categories?.location ?? '' }, company, 'lever'));
}

const PARSERS: Record<AtsType, (j: any, c: string) => Offer[]> = {
  greenhouse: parseGreenhouse,
  ashby: parseAshby,
  lever: parseLever,
};

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Fetch + parse one company's ATS board. Throws on transport/HTTP error. */
export async function scanCompany(company: CompanyInput): Promise<Offer[]> {
  const api = detectApi(company);
  if (!api) return [];
  const json = await fetchJson(api.url);
  return PARSERS[api.type](json, company.name);
}

export interface TitleFilter { positive: string[]; negative: string[]; }

/** career-ops title filter: keep if (no positives OR any positive) AND no negative. */
export function buildTitleFilter(tf?: TitleFilter): (title: string) => boolean {
  const positive = (tf?.positive ?? []).map(k => k.toLowerCase()).filter(Boolean);
  const negative = (tf?.negative ?? []).map(k => k.toLowerCase()).filter(Boolean);
  return (title: string) => {
    const t = (title || '').toLowerCase();
    const hasPos = positive.length === 0 || positive.some(k => t.includes(k));
    const hasNeg = negative.some(k => t.includes(k));
    return hasPos && !hasNeg;
  };
}

/** Run a bounded-concurrency pool over tasks. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  });
  await Promise.all(workers);
}
