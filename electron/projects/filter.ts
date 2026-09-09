/**
 * Bounded source-walk rules for project ingestion (pure — no fs, db or electron
 * imports, so vitest can load it).
 *
 * A deep dive has to actually read code, not just the README, because the work
 * worth talking about is usually buried in the source. But a big repo would
 * happily hand over tens of megabytes, and an LLM pass over that is neither
 * affordable nor honest. So a deep dive is capped:
 *
 *   - DEEP_MAX_CANDIDATES  files considered before ranking gives up walking
 *   - DEEP_MAX_FILES       files actually read
 *   - DEEP_MAX_TOTAL_BYTES bytes across all of them
 *   - DEEP_MAX_FILE_BYTES  from any single file (the head, which carries the
 *                          imports, the exports and the shape of the module)
 *
 * Ranking picks the files most likely to explain what the project does:
 * entry points and src/ code first, tests and generated noise last.
 */

/** Files considered while walking before we stop looking for more. */
export const DEEP_MAX_CANDIDATES = 4000;
/** Files actually read and sent to the model in a deep dive. */
export const DEEP_MAX_FILES = 60;
/** Total bytes read across a whole deep dive. */
export const DEEP_MAX_TOTAL_BYTES = 400_000;
/** Bytes read from any one file (its head). */
export const DEEP_MAX_FILE_BYTES = 20_000;
/** Characters per chunk handed to one summarize call. */
export const CHUNK_CHARS = 14_000;

/** Directories that never contain the candidate's own work. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'dist-electron', 'dist-installer',
  'build', 'out', 'target', 'vendor', 'bin', 'obj', 'coverage', '.next', '.nuxt',
  '.svelte-kit', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.cache', '.turbo', '.parcel-cache', '.gradle', '.idea', '.vscode', 'Pods',
  'site-packages', 'third_party', 'externals', '.terraform',
]);

/** Lock files and other machine-written noise. */
const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json',
  'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'composer.lock',
  'Gemfile.lock', 'pubspec.lock', 'mix.lock', 'flake.lock', '.ds_store',
]);

/** Extensions that are binary or otherwise not worth a token. */
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'icns', 'tif', 'tiff', 'avif',
  'pdf', 'zip', 'gz', 'tar', 'bz2', '7z', 'rar', 'xz',
  'exe', 'dll', 'so', 'dylib', 'node', 'wasm', 'class', 'jar', 'pyc', 'pyd', 'o', 'a', 'lib',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'avi', 'flac', 'm4a',
  'db', 'sqlite', 'sqlite3', 'bin', 'dat', 'pack', 'idx', 'psd', 'ai', 'blend',
  'onnx', 'safetensors', 'ckpt', 'pt', 'pth', 'h5', 'npy', 'npz', 'parquet',
]);

/** Manifest files, in the order we prefer them when a repo has several. */
export const MANIFEST_NAMES = [
  'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'requirements.txt',
  'composer.json', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'pubspec.yaml', 'mix.exs', 'Package.swift', 'CMakeLists.txt',
];

/** README file names, in preference order. */
export const README_NAMES = ['README.md', 'readme.md', 'README.MD', 'Readme.md', 'README.rst', 'README.txt', 'README'];

export function ext(p: string): string {
  const base = p.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isManifest(name: string): boolean {
  return MANIFEST_NAMES.includes(name) || /\.csproj$/i.test(name) || /\.fsproj$/i.test(name);
}

export function isSkippedDir(name: string): boolean {
  return SKIP_DIRS.has(name) || SKIP_DIRS.has(name.toLowerCase());
}

export function isSkippedFile(name: string): boolean {
  if (SKIP_FILES.has(name) || SKIP_FILES.has(name.toLowerCase())) return true;
  if (/\.min\.(js|css)$/i.test(name)) return true;
  if (/\.(map|lock)$/i.test(name)) return true;
  if (/^\./.test(name) && !/^\.(env\.example|gitignore|eslintrc.*|prettierrc.*)$/i.test(name)) return true;
  return BINARY_EXT.has(ext(name));
}

/** Should this repo-relative path be left out of a source walk entirely? */
export function shouldSkipPath(relPath: string): boolean {
  const parts = relPath.split('/').filter(Boolean);
  if (!parts.length) return true;
  const name = parts[parts.length - 1];
  for (const dir of parts.slice(0, -1)) if (isSkippedDir(dir)) return true;
  return isSkippedFile(name);
}

/** A NUL byte in the head is the cheapest reliable "this is not text" tell. */
export function looksBinaryContent(sample: string): boolean {
  const NUL = String.fromCharCode(0);
  return sample.slice(0, 8000).includes(NUL);
}

const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'cs', 'cpp', 'cc',
  'c', 'h', 'hpp', 'rb', 'php', 'swift', 'scala', 'ex', 'exs', 'dart', 'lua', 'sh', 'ps1',
  'sql', 'vue', 'svelte', 'r', 'jl', 'm', 'mm',
]);
const DOC_EXT = new Set(['md', 'rst', 'txt', 'adoc']);

/**
 * How much a file is worth reading, higher first. Entry points and top-level
 * source beat deeply nested helpers, and tests/fixtures come last because they
 * describe the code rather than the achievement.
 */
export function sourceScore(relPath: string): number {
  const lower = relPath.toLowerCase();
  const base = lower.split('/').pop() ?? '';
  const depth = relPath.split('/').length - 1;
  const e = ext(lower);

  let score = 0;
  if (CODE_EXT.has(e)) score += 40;
  else if (DOC_EXT.has(e)) score += 22;
  else if (['json', 'toml', 'yaml', 'yml', 'html', 'css', 'scss'].includes(e)) score += 10;
  else score += 2;

  if (isManifest(relPath.split('/').pop() ?? '')) score += 45;
  if (/^(readme|architecture|design|plan|todo|changelog)/i.test(base)) score += 35;
  if (/^(main|index|app|server|cli|run|__main__|program)\./.test(base)) score += 25;
  if (/^(src|lib|app|core|server|electron|packages|cmd|internal)\//.test(lower)) score += 12;
  if (/(^|\/)(tests?|spec|__tests__|fixtures?|mocks?|examples?|samples?|docs?)\//.test(lower)) score -= 25;
  if (/\.(test|spec)\.[a-z]+$/.test(base)) score -= 25;
  if (/(^|\/)(migrations?|generated|__generated__|proto|\.github)\//.test(lower)) score -= 15;

  score -= Math.min(depth * 4, 24);
  return score;
}

export interface WalkFile { path: string; size: number }

/**
 * Rank and trim a walked file list down to what a deep dive is allowed to read.
 * Files bigger than DEEP_MAX_FILE_BYTES still qualify; only their head is read,
 * so the byte budget counts the clipped size.
 */
export function pickSourceFiles(files: WalkFile[]): WalkFile[] {
  const eligible = files
    .filter(f => !shouldSkipPath(f.path))
    .map(f => ({ f, score: sourceScore(f.path) }))
    .sort((a, b) => (b.score - a.score) || (a.f.size - b.f.size) || a.f.path.localeCompare(b.f.path));

  const picked: WalkFile[] = [];
  let bytes = 0;
  for (const { f } of eligible) {
    if (picked.length >= DEEP_MAX_FILES) break;
    const take = Math.min(f.size || DEEP_MAX_FILE_BYTES, DEEP_MAX_FILE_BYTES);
    if (bytes + take > DEEP_MAX_TOTAL_BYTES) continue;
    bytes += take;
    picked.push({ path: f.path, size: take });
  }
  return picked;
}

export interface SourceFile { path: string; text: string }

/** Split read files into chunks small enough for one summarize call. */
export function chunkFiles(files: SourceFile[], maxChars = CHUNK_CHARS): SourceFile[][] {
  const chunks: SourceFile[][] = [];
  let current: SourceFile[] = [];
  let size = 0;
  for (const f of files) {
    const cost = f.text.length + f.path.length + 16;
    if (current.length && size + cost > maxChars) { chunks.push(current); current = []; size = 0; }
    current.push(f);
    size += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
