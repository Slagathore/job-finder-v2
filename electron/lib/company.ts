/** Normalize a company name for fuzzy matching (pure — no db imports). */
export function normalizeCompany(name: string): string {
  return (name || '').toLowerCase()
    .replace(/,?\s*(inc|llc|ltd|corp|corporation|co|technologies|labs?|ai|gmbh)\b\.?/g, '')
    .replace(/\s+/g, ' ').trim();
}
