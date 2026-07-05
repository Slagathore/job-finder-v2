import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, Notification } from 'electron';
import * as path from 'path';
import { initDb } from './ipc/db';
import { registerSettingsHandlers, readSettings, writeSetting, migrateSecrets } from './ipc/settings';
import { registerLlmHandlers } from './ipc/llm';
import { registerJobHandlers } from './ipc/jobs';
import { registerBoardHandlers, seedBoardsIfEmpty } from './ipc/boards';
import { registerScanHandlers } from './ipc/scan';
import { registerExperienceHandlers } from './ipc/experience';
import { registerDiscoveryHandlers } from './ipc/discovery';
import { registerGeoHandlers } from './ipc/geo';
import { registerRuleHandlers } from './ipc/rules';
import { registerApplyHandlers } from './ipc/apply';
import { registerAgentHandlers } from './ipc/agent';
import { registerSelfExtHandlers } from './ipc/selfext';
import { registerBlocklistHandlers } from './ipc/blocklist';
import { registerPipelineHandlers } from './ipc/pipeline';
import { registerNotificationHandlers, addNotification } from './ipc/notifications';
import { registerGmailHandlers, handleOAuthCode } from './ipc/gmail';
import { ingestInbox } from './gmail/ingest';
import { registerIntelHandlers } from './ipc/intel';
import { registerFollowupHandlers } from './ipc/followups';
import { registerMaintenanceHandlers } from './ipc/maintenance';
import { runPrune } from './maintenance/prune';
import { registerDigestHandlers } from './ipc/digest';
import { registerActivityHandlers } from './ipc/activity';
import { registerSearchHandlers } from './ipc/searches';
import { registerExportHandlers } from './ipc/export';
import { registerWatchHandlers } from './ipc/watch';
import { startHubServer } from './server/http';
import { ingestJobs, ingestFields } from './ingest/jobs';
import { getDb, closeDb } from './ipc/db';
import { killAllChildren } from './selfext/exec';
import { randomUUID } from 'crypto';
import { runScan } from './scan/runner';
import { runEmbeddings } from './discovery/service';
import type { Server } from 'http';

// Dev = unpackaged AND not forced to prod. JF_PROD lets `npm start` / a smoke
// test run the BUILT renderer (loadFile) without a Vite dev server.
const isDev = !app.isPackaged && !process.env.JF_PROD;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let closeToTray = true;
let quitting = false;
let scanTimer: NodeJS.Timeout | null = null;
let hubServer: Server | null = null;
let shuttingDown = false;

// Single-instance: a second launch focuses the existing window instead of
// starting a duplicate (which would fight over the DB + hub port).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

/** Graceful teardown: stop timers, close the hub server, kill sandbox child
 *  processes, and checkpoint+close the DB. Idempotent. */
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (embedTimer) { clearTimeout(embedTimer); embedTimer = null; }
  try { hubServer?.close(); } catch { /* */ }
  killAllChildren();
  closeDb();
}

/** Hard stop: ensure absolutely everything is dead, then exit immediately. */
function forceQuit(): void {
  quitting = true;
  killAllChildren();
  shutdown();
  app.exit(0);
}

/** Send to the renderer only if the window is alive — avoids throwing after the
 *  window is hidden/destroyed (e.g. background scan finishing during shutdown). */
function send(channel: string, ...args: any[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send(channel, ...args); } catch { /* renderer gone */ }
  }
}

function showWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function buildTray() {
  if (tray) return;
  let image = nativeImage.createFromPath(ICON);
  if (image.isEmpty()) { try { image = nativeImage.createEmpty(); } catch { /* */ } }
  else image = image.resize({ width: 16, height: 16 });
  try {
    tray = new Tray(image);
  } catch {
    tray = null;
    return;
  }
  tray.setToolTip('Job Finder');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Job Finder', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    { label: 'Force Quit (kill background)', click: () => forceQuit() },
  ]));
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

/**
 * Background scheduler (PLAN.md §6.19): on the configured cadence, runs an ATS
 * scan and (when Gmail is connected) a mail ingest, surfacing notifications.
 * Re-armed whenever the interval setting changes.
 */
function armScheduler() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  const minutes = Number(readSettings().scanIntervalMinutes) || 0;
  if (minutes <= 0) return;
  scanTimer = setInterval(() => {
    runScan('scheduled')
      .then(s => {
        console.log(`[scheduler] scan: +${s.added} jobs (${s.found} found, ${s.scanned} boards)`);
        if (s.added > 0) {
          try { addNotification('jobs', { added: s.added, found: s.found, scanned: s.scanned }); } catch { /* */ }
          if (readSettings().notifyOnNewJobs) {
            try { new Notification({ title: 'Job Finder', body: `${s.added} new job${s.added === 1 ? '' : 's'} from the latest scan` }).show(); } catch { /* */ }
          }
          send('scan:done', s);
          send('notify');
        }
      })
      .catch(err => console.error('[scheduler] scan failed:', err?.message ?? err));
    // Opportunistic retention prune (safe: untouched old discovered jobs only).
    try { runPrune(); } catch { /* */ }
    // Also ingest mail on the same cadence when Gmail is connected.
    if (readSettings().gmailRefreshToken) {
      ingestInbox()
        .then(r => { if (r.advanced > 0) send('notify'); })
        .catch(err => console.error('[scheduler] mail ingest failed:', err?.message ?? err));
    }
  }, minutes * 60_000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0f1115',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!quitting && closeToTray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

/** Generate + persist a hub token on first boot so the extension can pair. */
function ensureHubToken(): string {
  let token = readSettings().hubToken;
  if (!token) {
    token = randomUUID();
    writeSetting('hubToken', token);
  }
  return token;
}

// Auto-embed after extension harvests (PLAN §6.18 without the manual “Embed”
// click): debounced so a burst of pages triggers one embedding run at the end.
let embedTimer: NodeJS.Timeout | null = null;
function scheduleAutoEmbed() {
  if (embedTimer) clearTimeout(embedTimer);
  embedTimer = setTimeout(() => {
    embedTimer = null;
    runEmbeddings(false)
      .then(r => {
        if (r.jobsEmbedded > 0) { console.log(`[auto-embed] ${r.jobsEmbedded} jobs embedded`); send('notify'); }
      })
      .catch(err => console.error('[auto-embed] failed (LLM down is fine):', err?.message ?? err));
  }, 20_000);
}

// One stale alarm per site per 6h — a broken scraper shouldn't spam.
const staleAlerted = new Map<string, number>();
function scraperStale(site: string, url: string) {
  const last = staleAlerted.get(site) ?? 0;
  if (Date.now() - last < 6 * 3600_000) return;
  staleAlerted.set(site, Date.now());
  try { addNotification('scraper-stale', { site, url }); } catch { /* */ }
  try { new Notification({ title: 'Job Finder', body: `${site} scraper found 0 jobs on a results page — selectors may be stale.` }).show(); } catch { /* */ }
  send('notify');
}

function startIngressServer() {
  ensureHubToken();
  const port = Number(readSettings().hubPort) || 17893;
  hubServer = startHubServer(() => ({
    token: readSettings().hubToken,
    ingestJobs: (jobs: any[]) => {
      const r = ingestJobs(jobs);
      if (r.added > 0 || r.updated > 0) { send('notify'); scheduleAutoEmbed(); }
      return r;
    },
    ingestFields,
    scraperStale,
    status: () => ({ jobs: (getDb().prepare('SELECT COUNT(*) n FROM jobs').get() as { n: number }).n }),
    appVersion: app.getVersion(),
    oauthCallback: async (code: string) => {
      const msg = await handleOAuthCode(code);
      send('notify');
      return msg;
    },
  }), port);
}

function registerAppHandlers() {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:hubInfo', () => {
    const s = readSettings();
    return { port: s.hubPort, token: s.hubToken, url: `http://127.0.0.1:${s.hubPort}` };
  });
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('app:show', () => showWindow());
  ipcMain.handle('app:openPath', (_e, p: string) => shell.openPath(p));
  // Job URLs come from scraped/external sources — never hand file:/javascript:/
  // custom-protocol strings to the OS shell.
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    return shell.openExternal(url);
  });
  ipcMain.handle('app:setCloseToTray', (_e, v: boolean) => { closeToTray = !!v; return closeToTray; });
  ipcMain.handle('app:rearmScheduler', () => { armScheduler(); return true; });
  ipcMain.handle('app:pickPath', async (_e, opts: Electron.OpenDialogOptions = {}) => {
    const r = await dialog.showOpenDialog(mainWindow ?? undefined as any, opts);
    return r.canceled ? null : r.filePaths[0];
  });
}

// Crash safety net: log instead of dying silently. Boot failures get a visible
// error box (otherwise a throw before createWindow leaves a headless zombie).
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

app.whenReady().then(async () => {
  // Default File/Edit menu bar clashes with the dark UI; keep it in dev for the
  // reload/devtools accelerators.
  if (!isDev) Menu.setApplicationMenu(null);
  initDb();
  migrateSecrets();
  seedBoardsIfEmpty();
  closeToTray = !!readSettings().closeToTray;
  registerSettingsHandlers();
  registerLlmHandlers();
  registerJobHandlers();
  registerBoardHandlers();
  registerScanHandlers();
  registerExperienceHandlers();
  registerDiscoveryHandlers();
  registerGeoHandlers();
  registerRuleHandlers();
  registerApplyHandlers();
  registerAgentHandlers();
  registerSelfExtHandlers();
  registerBlocklistHandlers();
  registerPipelineHandlers();
  registerNotificationHandlers();
  registerGmailHandlers();
  registerIntelHandlers();
  registerFollowupHandlers();
  registerMaintenanceHandlers();
  registerDigestHandlers();
  registerActivityHandlers();
  registerSearchHandlers();
  registerExportHandlers();
  registerWatchHandlers();
  registerAppHandlers();
  try { const p = runPrune(); if (p.jobsDeleted || p.notificationsDeleted) console.log(`[prune] boot: -${p.jobsDeleted} jobs, -${p.notificationsDeleted} notifs`); } catch { /* */ }
  startIngressServer();
  createWindow();
  buildTray();
  armScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error('[boot] fatal:', err);
  try { dialog.showErrorBox('Job Finder failed to start', String(err?.stack ?? err)); } catch { /* */ }
  app.exit(1);
});

// Graceful teardown on every real quit path.
app.on('before-quit', () => { quitting = true; shutdown(); });
process.on('exit', () => shutdown());
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => forceQuit());

app.on('window-all-closed', () => {
  // With close-to-tray we keep running (window hidden, tray alive); only quit
  // when the user explicitly chose to.
  if (process.platform !== 'darwin' && quitting) app.quit();
});
