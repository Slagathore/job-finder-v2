import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { updateInstallSupport, describeUpdateError, isNewer, type InstallSupport } from './policy';

/**
 * The actual update install (the banner used to just open a web page).
 *
 * electron-updater does the parts that must not be hand-rolled:
 *  - reads latest.yml from the GitHub release, so it knows the exact asset
 *  - verifies the downloaded installer's sha512 against latest.yml
 *  - verifies the Authenticode publisher on Windows against `publisherName`
 *    from package.json → app-update.yml (this repo signs as CN=Charles Chambers,
 *    see SIGNING.md). A wrong or missing signature aborts the install.
 *  - hands off to the NSIS installer and exits so it can replace the files
 *
 * User data is untouched by all of this: everything the user owns lives in
 * %APPDATA%\Job Finder\ (data\jobfinder.db, backups, output, exports), and the
 * installer only replaces the app payload in the install directory.
 *
 * Honesty rules baked in here: `ok: true` is returned only after the installer
 * has been downloaded AND verified AND handed off. Every other path returns
 * `ok: false` with a reason, and any later updater error is pushed to the
 * renderer through `onError`.
 */

export interface InstallProgress { percent: number; transferred: number; total: number; bytesPerSecond: number; }
export interface InstallResult { ok: boolean; stage: 'unsupported' | 'busy' | 'check' | 'download' | 'installing'; error?: string; version?: string; }

export interface InstallHooks {
  onProgress?: (p: InstallProgress) => void;
  /** Fired for failures that surface after installUpdate() has returned. */
  onError?: (message: string) => void;
  /** Let the app drop its close-to-tray guard, or quitAndInstall cannot quit. */
  beforeQuit?: () => void;
}

let installing = false;
let wired = false;

function currentEnv() {
  return {
    packaged: app.isPackaged,
    // electron-builder sets this only inside the portable exe's unpacked run.
    portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
    platform: process.platform,
  };
}

/** Whether the "Download and install" button should be offered at all. */
export function installSupport(): InstallSupport {
  return updateInstallSupport(currentEnv());
}

export async function installUpdate(hooks: InstallHooks = {}): Promise<InstallResult> {
  const support = installSupport();
  if (!support.ok) return { ok: false, stage: 'unsupported', error: support.reason };
  if (installing) return { ok: false, stage: 'busy', error: 'An update is already downloading.' };
  installing = true;

  try {
    autoUpdater.autoDownload = false;          // we download only on an explicit click
    autoUpdater.autoInstallOnAppQuit = false;  // and only install through this flow
    autoUpdater.disableWebInstaller = true;    // full installer only, no web installer stub

    if (!wired) {
      wired = true;
      autoUpdater.on('error', (err: any) => hooks.onError?.(describeUpdateError(err?.message ?? String(err))));
    }
    autoUpdater.removeAllListeners('download-progress');
    autoUpdater.on('download-progress', (p: any) => hooks.onProgress?.({
      percent: Math.max(0, Math.min(100, Number(p?.percent) || 0)),
      transferred: Number(p?.transferred) || 0,
      total: Number(p?.total) || 0,
      bytesPerSecond: Number(p?.bytesPerSecond) || 0,
    }));

    const check = await autoUpdater.checkForUpdates();
    const version = check?.updateInfo?.version ?? '';
    if (!version || !isNewer(version, app.getVersion())) {
      return { ok: false, stage: 'check', error: 'No newer release is published. You are already up to date.' };
    }

    // Throws on a checksum mismatch or a publisher mismatch — both land in the
    // catch below and are reported as a failed install, because they are one.
    const files = await autoUpdater.downloadUpdate(check!.cancellationToken);
    if (!files || files.length === 0) {
      return { ok: false, stage: 'download', error: 'The updater downloaded no installer, so nothing was installed.' };
    }

    // Close-to-tray would veto the window close and leave the installer fighting
    // a running app for its own files.
    hooks.beforeQuit?.();
    // Let this IPC call return before the app exits, so the UI can say what is
    // happening instead of the window vanishing mid-promise.
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (e: any) {
        hooks.onError?.(describeUpdateError(e?.message ?? String(e)));
      }
    });
    return { ok: true, stage: 'installing', version };
  } catch (e: any) {
    return { ok: false, stage: 'download', error: describeUpdateError(e?.message ?? String(e)) };
  } finally {
    installing = false;
  }
}
