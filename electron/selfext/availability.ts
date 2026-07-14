/**
 * Where self-extension can and cannot run.
 *
 * Self-extension is a source-tree feature. The LLM writes whole .ts/.tsx files,
 * and nothing may be applied until the sandbox (electron/selfext/sandbox.ts)
 * clones the tree and gets `npm run lint` (tsc) and `npm test` (vitest) to pass
 * on it. That gate is mandatory: electron/ipc/selfext.ts refuses to apply a
 * proposal whose sandbox did not pass.
 *
 * A packaged install has none of what the gate needs. The app ships as
 * `resources/app.asar` (a read-only archive) containing only the compiled
 * `dist/` + `dist-electron/` bundles — no electron/, no src/, no tsconfig.json,
 * no devDependencies, no npm, no tsc, no vitest. So in a packaged build the
 * sandbox can never pass, the apply step can never run, and the tab would be a
 * feature that looks alive and can never finish.
 *
 * Shipping the toolchain instead (sources + tsc + vitest + node_modules, writing
 * a promoted bundle into userData for the next boot to load) was considered and
 * rejected: it means a signed app deliberately executing unsigned code from a
 * user-writable directory, which throws away exactly what the Authenticode
 * signature buys the update path. See the report next to this change.
 *
 * So: source checkouts get self-extension, packaged installs do not, and the tab
 * is hidden there rather than shipped dead.
 *
 * LATENT TRAP for whoever touches packaging next: do NOT "fix" this by setting
 * `asar: false` and adding the sources to build.files. Self-extension would then
 * write into the install directory, and the NSIS update (which uninstalls the
 * old version first) would silently destroy every applied patch.
 */
export interface SelfExtendAvailability {
  available: boolean;
  /** Empty when available; a user-facing explanation otherwise. */
  reason: string;
}

export function selfExtendAvailability(isPackaged: boolean): SelfExtendAvailability {
  if (isPackaged) {
    return {
      available: false,
      reason: 'Self-extension needs the TypeScript source tree, npm, and the test toolchain, which an installed build does not ship. ' +
        'Run Job Finder from a source checkout (npm run dev) to use it.',
    };
  }
  return { available: true, reason: '' };
}
