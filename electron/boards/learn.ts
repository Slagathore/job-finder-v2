import * as cheerio from 'cheerio';
import { generate, type ChatMessage } from '../llm/provider';
import { parseJsonLoose } from '../lib/json';
import { inferWorkMode, type Offer } from '../scan/ats';
import type { Settings } from '../ipc/settings';
import { fetchHtml } from './fetch-html';

export interface SiteAdapter {
  list: string;            // CSS selector for each job card
  title: string;           // relative selector for the title text
  url: string;             // relative selector whose href is the job link
  company?: string;
  location?: string;
}

const SYSTEM = `You are given the HTML of a company/job-board CAREERS LISTING page.
Produce CSS selectors to extract the list of jobs. Respond with ONLY this JSON (no prose):
{ "list": "<selector matching each job card/row>",
  "title": "<selector RELATIVE to a card for the job title text>",
  "url": "<selector RELATIVE to a card for the <a> whose href is the job link>",
  "company": "<relative selector or null>",
  "location": "<relative selector or null>" }
Prefer stable, semantic selectors. The "url" element must be (or contain) an anchor with href.`;

export function buildLearnPrompt(html: string): ChatMessage[] {
  // Trim scripts/styles to fit the model budget and focus on structure.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .slice(0, 14000);
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `HTML:\n${stripped}\n\nReturn the selector JSON.` },
  ];
}

export function parseAdapter(text: string): SiteAdapter | null {
  const p = parseJsonLoose<any>(text);
  if (!p || typeof p.list !== 'string' || typeof p.title !== 'string' || typeof p.url !== 'string') return null;
  return {
    list: p.list, title: p.title, url: p.url,
    company: typeof p.company === 'string' ? p.company : undefined,
    location: typeof p.location === 'string' ? p.location : undefined,
  };
}

/** Apply a learned adapter to page HTML via cheerio. Pure — testable. */
export function applyAdapter(html: string, a: SiteAdapter, baseUrl: string): Offer[] {
  const $ = cheerio.load(html);
  const out: Offer[] = [];
  $(a.list).each((_i, el) => {
    const card = $(el);
    const title = card.find(a.title).first().text().trim();
    const urlEl = card.find(a.url).first();
    let href = urlEl.attr('href') || urlEl.find('a').first().attr('href') || '';
    try { if (href) href = new URL(href, baseUrl).href; } catch { /* keep raw */ }
    if (!title || !href) return;
    const location = a.location ? card.find(a.location).first().text().trim() : '';
    out.push({
      title,
      url: href,
      company: a.company ? card.find(a.company).first().text().trim() : '',
      location,
      source: 'dom-adapter',
      workMode: inferWorkMode(location),
    });
  });
  return out;
}

export interface LearnResult { adapter: SiteAdapter; sample: Offer[]; count: number; }

/** Fetch a page, ask the LLM for selectors, and test them with cheerio. */
export async function learnSite(s: Settings, url: string): Promise<LearnResult | { error: string }> {
  const html = await fetchHtml(url);
  if (!html) return { error: 'Could not fetch the page HTML.' };
  let llm;
  try { llm = await generate(s, buildLearnPrompt(html), { temperature: 0.1, maxTokens: 600 }); }
  catch (e: any) { return { error: `LLM failed: ${e?.message ?? e}` }; }
  const adapter = parseAdapter(llm.text);
  if (!adapter) return { error: 'Model did not return usable selectors.' };
  const jobs = applyAdapter(html, adapter, url);
  return { adapter, sample: jobs.slice(0, 5), count: jobs.length };
}
