import { generate } from '../llm/provider';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { getProfile } from '../experience/store';
import {
  buildPortfolioPrompt, clusterProjectItems, parsePortfolioReview, portfolioSignature,
  type PortfolioReview, type ProjectLineItem,
} from './portfolio-prompt';

export type { PortfolioReview };

export interface PortfolioResult {
  review: PortfolioReview;
  itemCount: number;
  projectCount: number;
  cachedAt: number;
  fromCache: boolean;
}
export interface PortfolioEmpty {
  empty: true;
  message: string;
  /** Two different situations that both render as "nothing to show", so the UI
   *  can tell them apart: no projects ingested at all, versus projects exist
   *  but no review has been run against them yet. */
  reason: 'no-projects' | 'no-review';
}

/** The kind='project' line items the project ingestion subsystem produced. */
export function listProjectItems(): ProjectLineItem[] {
  return getDb().prepare(
    "SELECT id, text, source_ref, role, employer FROM experience_items WHERE kind = 'project' ORDER BY id"
  ).all() as ProjectLineItem[];
}

const EMPTY_MESSAGE =
  'No project line items yet. Open the Experience tab, use the Projects card to connect GitHub or point at a local folder, and run a scan. Then come back here.';

function readCache(signature: string): PortfolioResult | null {
  const row = getDb().prepare(
    'SELECT review, signature, item_count, project_count, created_at FROM portfolio_review ORDER BY id DESC LIMIT 1'
  ).get() as any;
  if (!row || row.signature !== signature) return null;
  try {
    return {
      review: JSON.parse(row.review), itemCount: row.item_count, projectCount: row.project_count,
      cachedAt: row.created_at, fromCache: true,
    };
  } catch { return null; }
}

/** The stored review, if the portfolio has not changed since it was written. */
export function getPortfolioReview(): PortfolioResult | PortfolioEmpty {
  const items = listProjectItems();
  if (!items.length) return { empty: true, message: EMPTY_MESSAGE, reason: 'no-projects' };
  return readCache(portfolioSignature(items))
    ?? { empty: true, message: 'No portfolio review yet. Run one to see what your projects prove.', reason: 'no-review' };
}

/**
 * Evaluate the portfolio as a job-search asset. Never calls the model with an
 * empty portfolio: with nothing ingested the honest answer is to say so and
 * point at the Projects card.
 */
export async function reviewPortfolio(force = false): Promise<PortfolioResult | PortfolioEmpty | { error: string }> {
  const items = listProjectItems();
  if (!items.length) return { empty: true, message: EMPTY_MESSAGE, reason: 'no-projects' };

  const signature = portfolioSignature(items);
  if (!force) {
    const cached = readCache(signature);
    if (cached) return cached;
  }

  const clusters = clusterProjectItems(items);
  try {
    const r = await generate(readSettings(), buildPortfolioPrompt(clusters, getProfile()), { temperature: 0.3, maxTokens: 30_000 });
    const review = parsePortfolioReview(r.text);
    const now = Date.now();
    const db = getDb();
    db.prepare(
      'INSERT INTO portfolio_review (review, signature, item_count, project_count, created_at) VALUES (?,?,?,?,?)'
    ).run(JSON.stringify(review), signature, items.length, clusters.length, now);
    // Keep only the few most recent reviews so the table cannot grow forever.
    db.prepare('DELETE FROM portfolio_review WHERE id NOT IN (SELECT id FROM portfolio_review ORDER BY id DESC LIMIT 5)').run();
    return { review, itemCount: items.length, projectCount: clusters.length, cachedAt: now, fromCache: false };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}
