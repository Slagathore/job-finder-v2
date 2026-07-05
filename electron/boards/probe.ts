import { detectApi, scanCompany, type Offer } from '../scan/ats';
import { extractJsonLdJobs } from './jsonld';
import { fetchHtml, looksJsRendered } from './fetch-html';

export interface ProbeResult {
  ingress: 'api' | 'structured' | 'dom';
  method: string;       // greenhouse|ashby|lever | json-ld | needs-adapter
  count: number;
  sample: Offer[];
  jsRendered?: boolean;
  note?: string;
}

/**
 * Detect the easiest ingress for a careers URL, in priority order
 * (PLAN.md §6.6): known ATS API → structured JSON-LD → DOM adapter (learn-this-site).
 */
export async function probeIngress(url: string): Promise<ProbeResult> {
  const api = detectApi({ name: '', url });
  if (api) {
    try {
      const offers = await scanCompany({ name: '', url });
      return { ingress: 'api', method: api.type, count: offers.length, sample: offers.slice(0, 3) };
    } catch (e: any) {
      return { ingress: 'api', method: api.type, count: 0, sample: [], note: `API error: ${e?.message ?? e}` };
    }
  }

  const html = await fetchHtml(url);
  if (!html) return { ingress: 'dom', method: 'needs-adapter', count: 0, sample: [], note: 'Could not fetch page.' };

  const jobs = extractJsonLdJobs(html, url);
  if (jobs.length) {
    return { ingress: 'structured', method: 'json-ld', count: jobs.length, sample: jobs.slice(0, 3) };
  }

  return {
    ingress: 'dom', method: 'needs-adapter', count: 0, sample: [],
    jsRendered: looksJsRendered(html),
    note: looksJsRendered(html)
      ? 'Page looks client-rendered — learn-this-site may find little in static HTML; the extension is the better path here.'
      : 'No ATS/JSON-LD found — try “Learn this site”.',
  };
}
