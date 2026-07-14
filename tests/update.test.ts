import { describe, it, expect } from 'vitest';
import { shouldNotify, isNewer, updateInstallSupport, describeUpdateError, UpdateStatus } from '../electron/update/policy';
import pkg from '../package.json';

const base: UpdateStatus = {
  available: true, latestVersion: '1.1.0', summary: 'Job Finder v1.1.0',
  emergency: false, emergencyMessage: '',
};

describe('isNewer', () => {
  it('compares semver-ish versions, tolerating a v prefix', () => {
    expect(isNewer('1.1.0', '1.0.0')).toBe(true);
    expect(isNewer('v1.0.1', '1.0.0')).toBe(true);
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);   // same version: no update
    expect(isNewer('1.0.0', '1.1.0')).toBe(false);   // older release: no update
  });

  it('does not flag a running dev build that is ahead of the last release', () => {
    // The old bug: comparing against main's HEAD commit meant main (always ahead
    // of the last release) produced a permanent "update available" nag.
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
  });
});

describe('update notification policy', () => {
  it('never notifies when no update is available', () => {
    expect(shouldNotify({ ...base, available: false }, '')).toBe(false);
    expect(shouldNotify({ ...base, available: false, emergency: true }, '')).toBe(false);
  });

  it('notifies by default when a newer release exists', () => {
    expect(shouldNotify(base, '')).toBe(true);
  });

  it('silence forever blocks normal updates', () => {
    expect(shouldNotify(base, 'forever')).toBe(false);
  });

  it('silence until-next blocks only the version the user dismissed', () => {
    expect(shouldNotify(base, 'until:1.1.0')).toBe(false);                          // same release
    expect(shouldNotify({ ...base, latestVersion: '1.2.0' }, 'until:1.1.0')).toBe(true); // newer release
  });

  it('emergency supersedes every silence choice', () => {
    const urgent = { ...base, emergency: true, emergencyMessage: 'security fix' };
    expect(shouldNotify(urgent, 'forever')).toBe(true);
    expect(shouldNotify(urgent, 'until:1.1.0')).toBe(true);
    expect(shouldNotify(urgent, '')).toBe(true);
  });
});

describe('updateInstallSupport', () => {
  const installed = { packaged: true, portable: false, platform: 'win32' };

  it('allows an in-app install only from an installed Windows build', () => {
    expect(updateInstallSupport(installed).ok).toBe(true);
  });

  it('refuses, with a reason, where the app cannot replace itself', () => {
    // A source checkout has no installer to hand off to.
    const dev = updateInstallSupport({ ...installed, packaged: false });
    expect(dev.ok).toBe(false);
    expect(dev.ok === false && dev.reason).toMatch(/source checkout/i);

    // The portable exe is the running file; NSIS cannot swap it underneath.
    const portable = updateInstallSupport({ ...installed, portable: true });
    expect(portable.ok).toBe(false);
    expect(portable.ok === false && portable.reason).toMatch(/portable/i);

    // Only the Windows installer is wired up.
    const linux = updateInstallSupport({ ...installed, platform: 'linux' });
    expect(linux.ok).toBe(false);
    expect(linux.ok === false && linux.reason).toMatch(/releases page/i);
  });
});

describe('describeUpdateError', () => {
  it('never dresses a rejected download up as a success', () => {
    for (const m of [
      'New version 1.1.0 is not signed by the application owner: publisher name mismatch',
      'sha512 checksum mismatch, expected abc, got def',
      'net::ERR_INTERNET_DISCONNECTED',
      'EPERM: operation not permitted',
      'Cannot find latest.yml in the latest release',
      'boom',
    ]) {
      // Every branch has to read as a failure: it says nothing was installed, or
      // it says what to do instead. None of them may imply the app updated.
      expect(describeUpdateError(m)).toMatch(/nothing was installed|could not reach|releases page/i);
    }
  });

  it('says plainly that a bad signature or a bad checksum installed nothing', () => {
    expect(describeUpdateError('New version 1.1.0 is not signed by the application owner: X'))
      .toMatch(/not signed.*Nothing was installed/is);
    expect(describeUpdateError('sha512 checksum mismatch')).toMatch(/checksum.*Nothing was installed/is);
  });

  it('explains a release that is missing its update metadata', () => {
    expect(describeUpdateError('Cannot find latest.yml in the latest release')).toMatch(/latest\.yml/);
  });

  it('falls back to the raw reason rather than swallowing it', () => {
    expect(describeUpdateError('weird failure')).toMatch(/nothing was installed: weird failure/i);
  });
});

// The install is only as safe as the release channel it is pointed at:
// electron-updater verifies the sha512 from latest.yml (needs `publish`), and
// the Authenticode publisher (needs `win.publisherName`, which electron-builder
// writes into app-update.yml). Drop either and verification silently degrades,
// so this is checked rather than trusted.
describe('release channel config (package.json)', () => {
  it('ships electron-updater as a runtime dependency', () => {
    expect(pkg.dependencies['electron-updater']).toBeTruthy();
  });

  it('points the updater at the GitHub release channel', () => {
    const publish = pkg.build.publish as any[];
    expect(publish?.[0]).toMatchObject({ provider: 'github', owner: 'Slagathore', repo: 'job-finder-v2' });
  });

  it('pins the Windows publisher so an unsigned or foreign installer is rejected', () => {
    // SIGNING.md: Azure Trusted Signing, cert CN=Charles Chambers.
    expect(pkg.build.win.publisherName).toContain('Charles Chambers');
  });
});
