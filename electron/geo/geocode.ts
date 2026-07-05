import { getDb } from '../ipc/db';
import { lookupAreaCode } from './areacodes';

export interface GeoResult { lat: number; lng: number; label: string; source: string; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let lastNominatim = 0;

function norm(q: string): string { return q.trim().toLowerCase().replace(/\s+/g, ' '); }

function cacheGet(q: string): GeoResult | null {
  const row = getDb().prepare('SELECT lat, lng, label, source FROM geo_cache WHERE query = ?').get(norm(q)) as any;
  if (!row) return null;
  if (row.source === 'none' || row.lat == null) return null;
  return { lat: row.lat, lng: row.lng, label: row.label, source: row.source };
}
function cacheSet(q: string, r: GeoResult | null) {
  getDb().prepare(
    'INSERT INTO geo_cache(query,lat,lng,label,source,cached_at) VALUES(?,?,?,?,?,?) ' +
    'ON CONFLICT(query) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,label=excluded.label,source=excluded.source,cached_at=excluded.cached_at'
  ).run(norm(q), r?.lat ?? null, r?.lng ?? null, r?.label ?? null, r?.source ?? 'none', Date.now());
}

/** Nominatim requires a descriptive UA and ≤1 req/sec; we self-throttle to 1.1s. */
async function nominatim(q: string): Promise<GeoResult | null> {
  const wait = 1100 - (Date.now() - lastNominatim);
  if (wait > 0) await sleep(wait);
  lastNominatim = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'job-finder-v2/0.1 (personal job search tool)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const arr: any[] = await res.json();
  if (!arr.length) return null;
  return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon), label: arr[0].display_name, source: 'nominatim' };
}

/**
 * Resolve free-text location → lat/lng. Accepts a state, city (any country),
 * a US area code, or a full address. Cached; area codes resolve instantly.
 */
export async function geocodeText(query: string): Promise<GeoResult | null> {
  const q = (query ?? '').trim();
  if (!q) return null;

  if (/^\d{3}$/.test(q)) {
    const ac = lookupAreaCode(q);
    if (ac) { const r = { ...ac, source: 'areacode' }; cacheSet(q, r); return r; }
  }

  const cached = cacheGet(q);
  if (cached) return cached;

  try {
    const r = await nominatim(q);
    cacheSet(q, r);  // caches null too (as 'none') to avoid hammering on misses
    return r;
  } catch {
    return null;
  }
}

/**
 * Geocode distinct non-remote job location strings (cached + throttled) and
 * stamp jobs.geo_lat/lng. Capped per run to stay within Nominatim's rate limit.
 */
export async function geocodeJobs(limit = 60): Promise<{ resolved: number; failed: number; remaining: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT location_raw FROM jobs
    WHERE geo_lat IS NULL AND (work_mode IS NULL OR work_mode != 'remote')
      AND location_raw IS NOT NULL AND TRIM(location_raw) != ''
  `).all() as { location_raw: string }[];

  const batch = rows.slice(0, limit);
  const upd = db.prepare('UPDATE jobs SET geo_lat = ?, geo_lng = ? WHERE location_raw = ?');
  let resolved = 0, failed = 0;
  for (const { location_raw } of batch) {
    const r = await geocodeText(location_raw);
    if (r) { upd.run(r.lat, r.lng, location_raw); resolved++; }
    else failed++;
  }
  return { resolved, failed, remaining: Math.max(0, rows.length - batch.length) };
}
