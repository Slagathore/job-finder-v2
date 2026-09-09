/**
 * Readable text and tech signals from a deployed web app (pure — no fetch, fs
 * or electron imports, so vitest can load it).
 *
 * Digesting a live site is the weakest of the three sources: there is no source
 * tree to read, so the honest thing to extract is what the page says about
 * itself plus whatever the build leaves behind in the markup.
 */

const TECH_SIGNALS: { name: string; test: RegExp }[] = [
  { name: 'React', test: /data-reactroot|__REACT_DEVTOOLS|react(-dom)?[.@\/-][\d.]|\/react\.production/i },
  { name: 'Next.js', test: /__NEXT_DATA__|\/_next\//i },
  { name: 'Vue', test: /data-v-[0-9a-f]{6,}|__VUE__|\/vue(@|\.)/i },
  { name: 'Nuxt', test: /__NUXT__|\/_nuxt\//i },
  { name: 'Svelte', test: /svelte-[0-9a-z]{6,}|\/_app\/immutable\//i },
  { name: 'Angular', test: /ng-version|\bng-app\b/i },
  { name: 'Tailwind CSS', test: /tailwind|\bclass="[^"]*\b(?:flex|grid)\s+(?:items-|justify-|gap-)/i },
  { name: 'Bootstrap', test: /bootstrap(\.min)?\.css|class="[^"]*\bcontainer-fluid\b/i },
  { name: 'Vite', test: /\/assets\/index-[A-Za-z0-9_-]{8}\.js|type="module"\s+crossorigin/i },
  { name: 'WordPress', test: /wp-content|wp-includes/i },
  { name: 'Django', test: /csrfmiddlewaretoken/i },
  { name: 'Rails', test: /csrf-param|rails-ujs/i },
  { name: 'Firebase', test: /firebaseio\.com|firebase(app|js)/i },
  { name: 'Supabase', test: /supabase\.co/i },
  { name: 'Vercel', test: /vercel\.app|x-vercel/i },
  { name: 'Netlify', test: /netlify\.app|netlify\.com/i },
  { name: 'Cloudflare Pages', test: /pages\.dev|cloudflare/i },
  { name: 'GitHub Pages', test: /github\.io/i },
  { name: 'Stripe', test: /js\.stripe\.com/i },
  { name: 'Three.js', test: /three(\.min)?\.js|THREE\./ },
  { name: 'WebGL / Canvas', test: /<canvas[\s>]/i },
  { name: 'Service worker / PWA', test: /serviceWorker\.register|manifest\.webmanifest/i },
];

export interface PageSignals {
  title: string;
  description: string;
  headings: string[];
  text: string;
  tech: string[];
}

/** Drop scripts, styles and markup, leaving the words a reader would see. */
export function visibleText(html: string): string {
  return String(html ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractPageSignals(html: string, maxTextChars = 12_000): PageSignals {
  const src = String(html ?? '');
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const desc =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(src)?.[1] ??
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(src)?.[1] ??
    '';
  const headings: string[] = [];
  const hRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = hRe.exec(src)) && headings.length < 40) {
    const h = visibleText(m[2]);
    if (h) headings.push(h);
  }
  const tech = TECH_SIGNALS.filter(t => t.test.test(src)).map(t => t.name);
  const text = visibleText(src).slice(0, maxTextChars);
  return { title, description: desc.trim(), headings, text, tech };
}

/** Host of a URL, used as the source_ref suffix. Empty string on junk input. */
export function urlHost(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

/** Render the signals as the fact sheet the model reads. */
export function signalsToFacts(url: string, s: PageSignals): string {
  const lines = [`URL: ${url}`];
  if (s.title) lines.push(`Page title: ${s.title}`);
  if (s.description) lines.push(`Meta description: ${s.description}`);
  if (s.tech.length) lines.push(`Detected tech: ${s.tech.join(', ')}`);
  if (s.headings.length) lines.push(`Headings:\n${s.headings.slice(0, 25).map(h => `- ${h}`).join('\n')}`);
  if (s.text) lines.push(`Page text:\n${s.text}`);
  return lines.join('\n\n');
}
