import { detectApi, scanCompany, type Offer } from './ats';
import { extractJsonLdJobs } from '../boards/jsonld';
import { applyAdapter } from '../boards/learn';
import { getAdapterForDomain } from '../boards/store';
import { fetchHtml } from '../boards/fetch-html';

export interface BoardLike { name: string; url: string; }

/**
 * Scan one board, dispatching by the best available ingress:
 *   1. ATS API (Greenhouse/Ashby/Lever)
 *   2. a learned DOM adapter for the domain (cheerio)
 *   3. structured JSON-LD on the page
 * Returns normalised offers; never throws (errors surface as empty + are
 * caught by the caller's per-board try/catch).
 */
export async function scanOneBoard(board: BoardLike): Promise<Offer[]> {
  if (detectApi({ name: board.name, url: board.url })) {
    return scanCompany({ name: board.name, url: board.url });
  }

  const html = await fetchHtml(board.url);
  if (!html) return [];

  const adapter = getAdapterForDomain(board.url);
  if (adapter) return applyAdapter(html, adapter, board.url);

  return extractJsonLdJobs(html, board.url);
}
