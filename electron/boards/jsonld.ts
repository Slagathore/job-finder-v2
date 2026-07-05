import { inferWorkMode } from '../scan/ats';
import type { Offer } from '../scan/ats';

/**
 * Extract schema.org JobPosting entries from a page's JSON-LD blocks
 * (PLAN.md §6.6 ingress tier 2). Pure — testable with fixture HTML. Handles
 * single postings, arrays, @graph, and ItemList wrappers.
 */
export function extractJsonLdJobs(html: string, baseUrl: string): Offer[] {
  const out: Offer[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: any;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    collect(data, baseUrl, out);
  }
  // Dedup by url within the page.
  const seen = new Set<string>();
  return out.filter(o => o.url && !seen.has(o.url) && seen.add(o.url));
}

function collect(node: any, baseUrl: string, out: Offer[]): void {
  if (!node) return;
  if (Array.isArray(node)) { for (const n of node) collect(n, baseUrl, out); return; }
  if (typeof node !== 'object') return;

  if (node['@graph']) collect(node['@graph'], baseUrl, out);
  if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
    for (const it of node.itemListElement) collect(it.item ?? it, baseUrl, out);
  }

  const type = node['@type'];
  const isPosting = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
  if (isPosting && node.title) {
    out.push({
      title: String(node.title).trim(),
      url: absolutize(node.url || node.mainEntityOfPage || baseUrl, baseUrl),
      company: orgName(node.hiringOrganization),
      location: locationText(node.jobLocation),
      source: 'jsonld',
      workMode: inferWorkMode(locationText(node.jobLocation)) ??
        (node.jobLocationType === 'TELECOMMUTE' ? 'remote' : null),
    });
  }
}

function orgName(org: any): string {
  if (!org) return '';
  if (typeof org === 'string') return org;
  return String(org.name ?? '').trim();
}

function locationText(loc: any): string {
  if (!loc) return '';
  if (Array.isArray(loc)) return loc.map(locationText).filter(Boolean).join('; ');
  const a = loc.address ?? loc;
  if (typeof a === 'string') return a;
  return [a.addressLocality, a.addressRegion, a.addressCountry]
    .map((x: any) => (typeof x === 'object' ? x?.name : x)).filter(Boolean).join(', ');
}

function absolutize(href: string, baseUrl: string): string {
  try { return new URL(href, baseUrl).href; } catch { return href; }
}
