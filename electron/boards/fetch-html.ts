/** Fetch a page's HTML with a browser-like UA. Returns '' on any failure. */
export async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 job-finder-v2',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

/** Cheap heuristic: does the HTML look client-rendered (jobs likely not static)? */
export function looksJsRendered(html: string): boolean {
  return /__NEXT_DATA__|window\.__NUXT__|id="root"|data-reactroot|ng-version/.test(html);
}
