import { getDb } from '../ipc/db';

/**
 * BLS OEWS wage grounding — the one FREE source of real (government) salary
 * data. Given a 6-digit SOC occupation code, fetch the national cross-industry
 * ANNUAL MEDIAN wage from the BLS public API (v1: no key, generous enough with
 * caching). Series id layout (verified live 2026-07):
 *   OE + U(nadj) + N(ational) + 0000000(area) + 000000(x-industry) + SOC6 + 13(annual median)
 *   e.g. SOC 15-1252 → OEUN000000000000015125213 → $135,980 (2025)
 * Results cache per-SOC for 180 days (OEWS updates annually).
 */

const CACHE_MS = 180 * 24 * 3600_000;
const FETCH_TIMEOUT_MS = 8_000;

export interface BlsWage { soc: string; annualMedian: number; year: string; }

export function socToSeriesId(soc: string): string {
  return `OEUN0000000000000${soc.replace('-', '')}13`;
}

export async function blsMedianForSoc(soc: string): Promise<BlsWage | null> {
  const db = getDb();
  const cached = db.prepare('SELECT annual_median, year, cached_at FROM bls_wage_cache WHERE soc = ?').get(soc) as any;
  if (cached && Date.now() - cached.cached_at < CACHE_MS) {
    return cached.annual_median ? { soc, annualMedian: cached.annual_median, year: cached.year } : null;
  }

  let median: number | null = null, year = '';
  try {
    const res = await fetch(
      `https://api.bls.gov/publicAPI/v1/timeseries/data/${socToSeriesId(soc)}?latest=true`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (res.ok) {
      const json: any = await res.json();
      const point = json?.Results?.series?.[0]?.data?.[0];
      const v = Number(point?.value);
      if (Number.isFinite(v) && v > 0) { median = Math.round(v); year = String(point.year ?? ''); }
    }
  } catch { /* offline / rate-limited — cache the miss and move on */ }

  db.prepare(`
    INSERT INTO bls_wage_cache (soc, annual_median, year, cached_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(soc) DO UPDATE SET annual_median = excluded.annual_median, year = excluded.year, cached_at = excluded.cached_at
  `).run(soc, median, year, Date.now());

  return median ? { soc, annualMedian: median, year } : null;
}
