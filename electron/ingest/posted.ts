/**
 * Posting age + soft expiry (pure — no db/electron imports, so it stays testable).
 *
 * Aggregators rarely give a real posting date; they give relative text like
 * "Posted 3 days ago" or "Active 30+ days ago". We parse that into an absolute
 * timestamp where we can, then derive a SOFT expiry.
 *
 * Soft is the important word: an expiry derived from posting age is a guess, not
 * a fact. It is used to grey out and de-rank stale listings, never to delete them.
 * The authoritative signal is a liveness re-check of the URL (apply/liveness.ts);
 * this is the cheap offline approximation for everything not yet re-checked.
 */

/** Default shelf life for a posting, in days, when nothing better is known. */
export const DEFAULT_SHELF_LIFE_DAYS = 45;
/** Postings we know are already old get a shorter remaining life. */
export const STALE_POSTING_DAYS = 30;

const DAY = 86_400_000;

/**
 * Parse relative posting text into an absolute epoch ms, relative to `now`.
 * Handles "just posted", "today", "3 days ago", "30+ days ago", "2 weeks ago",
 * "a month ago", "Posted 5 hours ago". Returns null when nothing parses.
 */
export function parsePostedAt(text: string | null | undefined, now = Date.now()): number | null {
  if (!text) return null;
  const s = String(text).toLowerCase().trim();
  if (!s) return null;

  if (/\b(just posted|today|just now|new)\b/.test(s)) return now;
  if (/\byesterday\b/.test(s)) return now - DAY;

  // "30+ days ago" — treat the plus as "at least", so use the stated number.
  const m = /(\d+)\s*\+?\s*(minute|hour|day|week|month|year)s?\s*(?:ago)?/.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n < 0) return null;
    const unit = m[2];
    const ms =
      unit === 'minute' ? 60_000 :
      unit === 'hour' ? 3_600_000 :
      unit === 'day' ? DAY :
      unit === 'week' ? 7 * DAY :
      unit === 'month' ? 30 * DAY :
      365 * DAY;
    return now - n * ms;
  }

  // "a day ago" / "an hour ago"
  const a = /\ba[n]?\s+(hour|day|week|month)\s+ago\b/.exec(s);
  if (a) {
    const unit = a[1];
    const ms = unit === 'hour' ? 3_600_000 : unit === 'day' ? DAY : unit === 'week' ? 7 * DAY : 30 * DAY;
    return now - ms;
  }

  // An ISO-ish absolute date, which real ATS feeds (schema.org datePosted) do give.
  const iso = Date.parse(s);
  if (Number.isFinite(iso) && iso > 0 && iso <= now + DAY) return iso;

  return null;
}

/**
 * Derive the soft expiry for a posting. Counts from the posting date when known,
 * otherwise from when we first saw it. A posting already older than
 * STALE_POSTING_DAYS when harvested gets a short remaining life rather than a
 * full shelf life, because it is already deep into its natural lifespan.
 */
export function deriveExpiresAt(
  postedAt: number | null | undefined,
  firstSeen: number,
  shelfLifeDays = DEFAULT_SHELF_LIFE_DAYS
): number {
  const anchor = postedAt ?? firstSeen;
  const ageDays = Math.max(0, (firstSeen - anchor) / DAY);
  if (ageDays >= STALE_POSTING_DAYS) return firstSeen + 14 * DAY;
  return anchor + shelfLifeDays * DAY;
}

/** True when the soft expiry has passed. */
export function isExpired(expiresAt: number | null | undefined, now = Date.now()): boolean {
  return expiresAt != null && expiresAt > 0 && expiresAt < now;
}
