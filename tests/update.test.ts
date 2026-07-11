import { describe, it, expect } from 'vitest';
import { shouldNotify, isNewer, UpdateStatus } from '../electron/update/policy';

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
