import { describe, it, expect } from 'vitest';
import { shouldNotify, UpdateStatus } from '../electron/update/policy';

const base: UpdateStatus = {
  available: true, latestSha: 'abc123', summary: 'fix: things',
  emergency: false, emergencyMessage: '',
};

describe('update notification policy', () => {
  it('never notifies when no update is available', () => {
    expect(shouldNotify({ ...base, available: false }, '')).toBe(false);
    expect(shouldNotify({ ...base, available: false, emergency: true }, '')).toBe(false);
  });

  it('notifies by default when an update is available', () => {
    expect(shouldNotify(base, '')).toBe(true);
  });

  it('silence forever blocks normal updates', () => {
    expect(shouldNotify(base, 'forever')).toBe(false);
  });

  it('silence until-next blocks only the sha the user saw', () => {
    expect(shouldNotify(base, 'until:abc123')).toBe(false);       // same update
    expect(shouldNotify({ ...base, latestSha: 'def456' }, 'until:abc123')).toBe(true); // newer push
  });

  it('emergency supersedes every silence choice', () => {
    const urgent = { ...base, emergency: true, emergencyMessage: 'security fix' };
    expect(shouldNotify(urgent, 'forever')).toBe(true);
    expect(shouldNotify(urgent, 'until:abc123')).toBe(true);
    expect(shouldNotify(urgent, '')).toBe(true);
  });
});
