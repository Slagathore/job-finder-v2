import { describe, it, expect } from 'vitest';
import {
  CHUNK_CHARS, DEEP_MAX_FILES, DEEP_MAX_FILE_BYTES, DEEP_MAX_TOTAL_BYTES,
  chunkFiles, ext, isManifest, isSkippedDir, isSkippedFile, looksBinaryContent,
  pickSourceFiles, shouldSkipPath, sourceScore,
} from '../electron/projects/filter';
import { looksLikeToken, missingScopes, parseGhAuthStatus, stripAnsi } from '../electron/projects/gh-parse';
import {
  buildChunkPrompt, buildDeepPrompt, buildFactSheet, buildMediumPrompt,
  parseProjectItems, progressPercent,
} from '../electron/projects/prompt';
import { extractPageSignals, signalsToFacts, urlHost, visibleText } from '../electron/projects/webapp';
import { alreadyDigested } from '../electron/projects/resume-rule';

describe('walk filter', () => {
  it('reads extensions off a path', () => {
    expect(ext('src/app/main.TS')).toBe('ts');
    expect(ext('Makefile')).toBe('');
    expect(ext('.gitignore')).toBe('');
  });

  it('skips vendored, generated and binary paths', () => {
    expect(shouldSkipPath('node_modules/react/index.js')).toBe(true);
    expect(shouldSkipPath('dist/bundle.js')).toBe(true);
    expect(shouldSkipPath('.git/config')).toBe(true);
    expect(shouldSkipPath('package-lock.json')).toBe(true);
    expect(shouldSkipPath('assets/logo.png')).toBe(true);
    expect(shouldSkipPath('src/lib/vendor.min.js')).toBe(true);
    expect(shouldSkipPath('src/index.ts')).toBe(false);
    expect(shouldSkipPath('electron/ipc/db.ts')).toBe(false);
  });

  it('recognises skip dirs and lock files by name', () => {
    expect(isSkippedDir('node_modules')).toBe(true);
    expect(isSkippedDir('src')).toBe(false);
    expect(isSkippedFile('yarn.lock')).toBe(true);
    expect(isSkippedFile('main.rs')).toBe(false);
  });

  it('spots manifests, including csproj', () => {
    expect(isManifest('package.json')).toBe(true);
    expect(isManifest('pyproject.toml')).toBe(true);
    expect(isManifest('Cargo.toml')).toBe(true);
    expect(isManifest('go.mod')).toBe(true);
    expect(isManifest('MyApp.csproj')).toBe(true);
    expect(isManifest('index.ts')).toBe(false);
  });

  it('calls a NUL-bearing head binary', () => {
    expect(looksBinaryContent(`abc${String.fromCharCode(0)}def`)).toBe(true);
    expect(looksBinaryContent('plain source text')).toBe(false);
  });

  it('ranks entry points and manifests above buried test fixtures', () => {
    expect(sourceScore('package.json')).toBeGreaterThan(sourceScore('src/util/helpers.ts'));
    expect(sourceScore('src/main.ts')).toBeGreaterThan(sourceScore('src/a/b/c/d/thing.ts'));
    expect(sourceScore('src/index.ts')).toBeGreaterThan(sourceScore('tests/index.test.ts'));
  });

  it('honours the file-count cap', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ path: `src/mod${i}.ts`, size: 100 }));
    expect(pickSourceFiles(many)).toHaveLength(DEEP_MAX_FILES);
  });

  it('honours the byte cap and clips oversized files to the per-file cap', () => {
    const huge = Array.from({ length: 40 }, (_, i) => ({ path: `src/big${i}.ts`, size: 5_000_000 }));
    const picked = pickSourceFiles(huge);
    const bytes = picked.reduce((a, f) => a + f.size, 0);
    expect(bytes).toBeLessThanOrEqual(DEEP_MAX_TOTAL_BYTES);
    for (const f of picked) expect(f.size).toBeLessThanOrEqual(DEEP_MAX_FILE_BYTES);
  });

  it('drops skipped paths before ranking', () => {
    const picked = pickSourceFiles([
      { path: 'node_modules/x/index.js', size: 10 },
      { path: 'src/index.ts', size: 10 },
    ]);
    expect(picked.map(p => p.path)).toEqual(['src/index.ts']);
  });

  it('chunks files without exceeding the chunk budget by more than one file', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.ts`, text: 'x'.repeat(5000) }));
    const chunks = chunkFiles(files);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(10);
    for (const c of chunks) {
      const size = c.reduce((a, f) => a + f.text.length, 0);
      expect(size).toBeLessThanOrEqual(CHUNK_CHARS + 5000);
    }
  });

  it('keeps a single oversized file in its own chunk rather than dropping it', () => {
    const chunks = chunkFiles([{ path: 'big.ts', text: 'y'.repeat(CHUNK_CHARS * 3) }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0][0].path).toBe('big.ts');
  });
});

describe('gh auth status parsing', () => {
  const REAL = `github.com
  ✓ Logged in to github.com account Slagathore (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'`;

  it('reads the login, host and scopes off a real report', () => {
    const info = parseGhAuthStatus(REAL);
    expect(info.authenticated).toBe(true);
    expect(info.login).toBe('Slagathore');
    expect(info.host).toBe('github.com');
    expect(info.scopes).toEqual(['gist', 'read:org', 'repo', 'workflow']);
  });

  it('reads the older "logged in as" wording', () => {
    const info = parseGhAuthStatus('✓ Logged in to github.com as octocat (oauth_token)');
    expect(info.authenticated).toBe(true);
    expect(info.login).toBe('octocat');
  });

  it('reports a logged out CLI', () => {
    const info = parseGhAuthStatus('You are not logged into any GitHub hosts. Run gh auth login to authenticate.');
    expect(info.authenticated).toBe(false);
    expect(info.login).toBe('');
  });

  it('handles empty output', () => {
    expect(parseGhAuthStatus('').authenticated).toBe(false);
  });

  it('strips colour codes before parsing', () => {
    const coloured = `${String.fromCharCode(27)}[0;32m✓${String.fromCharCode(27)}[0m Logged in to github.com account Slagathore`;
    expect(stripAnsi(coloured)).not.toContain('[0;32m');
    expect(parseGhAuthStatus(coloured).login).toBe('Slagathore');
  });

  it('flags a missing repo scope, which is what hides private repos', () => {
    expect(missingScopes(['gist', 'read:org', 'repo'])).toEqual([]);
    expect(missingScopes(['gist'])).toEqual(['repo']);
  });

  it('sanity checks a pasted token before spending a round trip', () => {
    expect(looksLikeToken('ghp_' + 'a'.repeat(36))).toBe(true);
    expect(looksLikeToken('github_pat_' + 'A1b2'.repeat(10))).toBe(true);
    expect(looksLikeToken('f'.repeat(40))).toBe(true);
    expect(looksLikeToken('not a token')).toBe(false);
    expect(looksLikeToken('')).toBe(false);
  });
});

describe('project prompts', () => {
  const facts = {
    name: 'Slagathore/sparkles-mtg-meta',
    description: 'Magic metagame analytics',
    url: 'https://github.com/Slagathore/sparkles-mtg-meta',
    isPrivate: true,
    language: 'Python',
    languages: { Python: 8000, TypeScript: 2000 },
    pushedAt: '2026-08-01T00:00:00Z',
    readme: '# sparkles\nDeck clustering over tournament results.',
    manifestName: 'pyproject.toml',
    manifest: '[project]\nname = "sparkles"',
    tree: ['README.md', 'src/', 'pyproject.toml'],
  };

  it('puts the metadata a reviewer would want into the fact sheet', () => {
    const sheet = buildFactSheet(facts);
    expect(sheet).toContain('Slagathore/sparkles-mtg-meta');
    expect(sheet).toContain('Visibility: private');
    expect(sheet).toContain('Python 80%');
    expect(sheet).toContain('pyproject.toml');
    expect(sheet).toContain('Deck clustering');
  });

  it('clips a giant readme instead of sending it whole', () => {
    const sheet = buildFactSheet({ ...facts, readme: 'z'.repeat(60_000) });
    expect(sheet).toContain('[truncated]');
    expect(sheet.length).toBeLessThan(30_000);
  });

  it('builds a two message medium prompt', () => {
    const msgs = buildMediumPrompt(facts);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toContain('JSON array');
  });

  it('puts every file path in the chunk prompt', () => {
    const msgs = buildChunkPrompt('proj', [
      { path: 'src/a.ts', text: 'export const a = 1;' },
      { path: 'src/b.ts', text: 'export const b = 2;' },
    ]);
    expect(msgs[1].content).toContain('src/a.ts');
    expect(msgs[1].content).toContain('src/b.ts');
    expect(msgs[1].content).toContain('export const b = 2;');
  });

  it('tells the deep prompt to trust the source notes over the readme', () => {
    const msgs = buildDeepPrompt(facts, ['- parses tournament exports', '- clusters decks']);
    expect(msgs[0].content).toContain('the code is evidence');
    expect(msgs[1].content).toContain('clusters decks');
  });

  it('parses project line items and drops kinds that do not belong', () => {
    const items = parseProjectItems(JSON.stringify([
      { kind: 'project', text: 'Built sparkles, a metagame analytics tool.' },
      { kind: 'tool', text: 'Python' },
      { kind: 'education', text: 'BSc' },       // not a project kind, dropped
      { kind: 'tool', text: 'Python' },          // duplicate, dropped
    ]), 'sparkles');
    expect(items).toHaveLength(2);
    expect(items.map(i => i.kind)).toEqual(['project', 'tool']);
  });

  it('blanks employer and role, since a side project is not a job', () => {
    const items = parseProjectItems(JSON.stringify([
      { kind: 'project', text: 'Built a thing', employer: 'Made Up Corp', role: 'CTO' },
    ]), 'thing');
    expect(items[0].employer).toBeNull();
    expect(items[0].role).toBeNull();
  });

  it('throws on an unusable response instead of silently storing nothing', () => {
    expect(() => parseProjectItems('the model said hello', 'sparkles')).toThrow(/sparkles/);
    expect(() => parseProjectItems('[]', 'sparkles')).toThrow(/no usable line items/);
  });

  it('salvages a token-capped array rather than failing the repo', () => {
    const truncated = '[{"kind":"project","text":"Built sparkles"},{"kind":"tool","text":"Python"},{"kind":"to';
    expect(parseProjectItems(truncated, 'sparkles')).toHaveLength(2);
  });

  it('clamps the percent', () => {
    expect(progressPercent(0, 36)).toBe(0);
    expect(progressPercent(18, 36)).toBe(50);
    expect(progressPercent(36, 36)).toBe(100);
    expect(progressPercent(40, 36)).toBe(100);
    expect(progressPercent(1, 0)).toBe(0);
  });
});

describe('web app signals', () => {
  const HTML = `<html><head><title>Deck Lab</title>
    <meta name="description" content="Build and test Magic decks" />
    <script src="/_next/static/chunk.js"></script></head>
    <body><h1>Deck Lab</h1><h2>Simulate 10,000 games</h2>
    <script>console.log('noise')</script>
    <style>.a{color:red}</style>
    <p>Paste a decklist and get a mulligan report.</p></body></html>`;

  it('strips scripts and styles out of the readable text', () => {
    const text = visibleText(HTML);
    expect(text).toContain('Paste a decklist');
    expect(text).not.toContain('console.log');
    expect(text).not.toContain('color:red');
  });

  it('pulls title, description, headings and tech signals', () => {
    const s = extractPageSignals(HTML);
    expect(s.title).toBe('Deck Lab');
    expect(s.description).toBe('Build and test Magic decks');
    expect(s.headings).toEqual(['Deck Lab', 'Simulate 10,000 games']);
    expect(s.tech).toContain('Next.js');
  });

  it('decodes the entities a scraped page is full of', () => {
    expect(visibleText('<p>a&nbsp;&amp;&nbsp;b</p>')).toBe('a & b');
  });

  it('reads the host for the source ref, and refuses junk', () => {
    expect(urlHost('https://decklab.example.com/app')).toBe('decklab.example.com');
    expect(urlHost('not a url')).toBe('');
  });

  it('renders the fact sheet a model can read', () => {
    const facts = signalsToFacts('https://decklab.example.com', extractPageSignals(HTML));
    expect(facts).toContain('URL: https://decklab.example.com');
    expect(facts).toContain('Detected tech: ');
    expect(facts).toContain('Deck Lab');
  });
});

describe('resume rules', () => {
  const row = (over: any) => ({
    id: 1, full_name: 'Slagathore/x', private: 1, description: null, language: null,
    pushed_at: null, html_url: null, default_branch: 'main', state: 'done',
    depth: 'medium', items: 5, digested_at: 1, last_error: null, updated_at: 1, ...over,
  }) as any;

  it('skips a repo already done at the depth asked for', () => {
    expect(alreadyDigested(row({}), 'medium')).toBe(true);
    expect(alreadyDigested(row({ depth: 'deep' }), 'medium')).toBe(true);
    expect(alreadyDigested(row({ depth: 'deep' }), 'deep')).toBe(true);
  });

  it('redoes a repo when a deeper pass is asked for', () => {
    expect(alreadyDigested(row({}), 'deep')).toBe(false);
  });

  it('never skips a failed, pending or unknown repo', () => {
    expect(alreadyDigested(row({ state: 'error' }), 'medium')).toBe(false);
    expect(alreadyDigested(row({ state: 'pending', depth: null }), 'medium')).toBe(false);
    expect(alreadyDigested(null, 'medium')).toBe(false);
  });
});
