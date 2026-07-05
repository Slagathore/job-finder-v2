/**
 * Seed company list for the ATS scanner, distilled from
 * ../career-ops/templates/portals.example.yml — only the entries whose
 * careers_url resolves to a Greenhouse / Ashby / Lever API (detectApi handles
 * the rest). This is a starter set; the user adds/removes via the Boards tab,
 * and the agent can learn new ones (PLAN.md §6.6).
 */
export interface SeedCompany { name: string; url: string; type: 'ats'; }

export const SEED_COMPANIES: SeedCompany[] = [
  // ── Greenhouse ──
  { name: 'Anthropic', url: 'https://job-boards.greenhouse.io/anthropic', type: 'ats' },
  { name: 'PolyAI', url: 'https://job-boards.eu.greenhouse.io/polyai', type: 'ats' },
  { name: 'Parloa', url: 'https://job-boards.eu.greenhouse.io/parloa', type: 'ats' },
  { name: 'Intercom', url: 'https://job-boards.greenhouse.io/intercom', type: 'ats' },
  { name: 'Hume AI', url: 'https://job-boards.greenhouse.io/humeai', type: 'ats' },
  { name: 'Airtable', url: 'https://job-boards.greenhouse.io/airtable', type: 'ats' },
  { name: 'Vercel', url: 'https://job-boards.greenhouse.io/vercel', type: 'ats' },
  { name: 'Temporal', url: 'https://job-boards.greenhouse.io/temporal', type: 'ats' },
  { name: 'Arize AI', url: 'https://job-boards.greenhouse.io/arizeai', type: 'ats' },
  { name: 'Glean', url: 'https://job-boards.greenhouse.io/gleanwork', type: 'ats' },
  { name: 'Speechmatics', url: 'https://job-boards.greenhouse.io/speechmatics', type: 'ats' },
  { name: 'Black Forest Labs', url: 'https://job-boards.greenhouse.io/blackforestlabs', type: 'ats' },
  { name: 'Helsing', url: 'https://job-boards.greenhouse.io/helsing', type: 'ats' },
  { name: 'Celonis', url: 'https://job-boards.greenhouse.io/celonis', type: 'ats' },
  { name: 'Contentful', url: 'https://job-boards.greenhouse.io/contentful', type: 'ats' },
  { name: 'Wayve', url: 'https://job-boards.greenhouse.io/wayve', type: 'ats' },
  { name: 'Stability AI', url: 'https://job-boards.greenhouse.io/stabilityai', type: 'ats' },
  { name: 'Runway', url: 'https://job-boards.greenhouse.io/runwayml', type: 'ats' },
  { name: 'Hightouch', url: 'https://job-boards.greenhouse.io/hightouch', type: 'ats' },
  { name: 'PlanetScale', url: 'https://job-boards.greenhouse.io/planetscale', type: 'ats' },

  // ── Ashby ──
  { name: 'Cohere', url: 'https://jobs.ashbyhq.com/cohere', type: 'ats' },
  { name: 'LangChain', url: 'https://jobs.ashbyhq.com/langchain', type: 'ats' },
  { name: 'Pinecone', url: 'https://jobs.ashbyhq.com/pinecone', type: 'ats' },
  { name: 'Supabase', url: 'https://jobs.ashbyhq.com/supabase', type: 'ats' },
  { name: 'Clerk', url: 'https://jobs.ashbyhq.com/clerk', type: 'ats' },
  { name: 'Resend', url: 'https://jobs.ashbyhq.com/resend', type: 'ats' },
  { name: 'Zapier', url: 'https://jobs.ashbyhq.com/zapier', type: 'ats' },
  { name: 'n8n', url: 'https://jobs.ashbyhq.com/n8n', type: 'ats' },
  { name: 'Perplexity', url: 'https://jobs.ashbyhq.com/perplexity', type: 'ats' },
  { name: 'Synthesia', url: 'https://jobs.ashbyhq.com/synthesia', type: 'ats' },

  // ── Lever ──
  { name: 'Mistral AI', url: 'https://jobs.lever.co/mistral', type: 'ats' },
  { name: 'Weights & Biases', url: 'https://jobs.lever.co/wandb', type: 'ats' },
  { name: 'Palantir', url: 'https://jobs.lever.co/palantir', type: 'ats' },
  { name: 'Spotify', url: 'https://jobs.lever.co/spotify', type: 'ats' },
  { name: 'Pigment', url: 'https://jobs.lever.co/pigment', type: 'ats' },
];
