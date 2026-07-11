import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drive safeStorage availability per-test: this is the Linux-without-keyring case.
const state = { available: true };

vi.mock('electron', () => ({
  ipcMain: { handle: () => {} },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => Buffer.from(b).toString('utf-8').replace(/^enc:/, ''),
  },
}));

const store = new Map<string, string>();
vi.mock('../electron/ipc/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (k: string, v: string) => { store.set(k, v); },
      get: (k: string) => (store.has(k) ? { value: store.get(k) } : undefined),
      all: () => [...store.entries()].map(([key, value]) => ({ key, value })),
    }),
  }),
}));

import { writeSetting, readSettings, secretsAvailable, SecretStorageUnavailableError } from '../electron/ipc/settings';

describe('secret storage', () => {
  beforeEach(() => { store.clear(); state.available = true; });

  it('encrypts secrets at rest and decrypts them transparently', () => {
    writeSetting('anthropicApiKey', 'sk-ant-secret');
    const raw = store.get('anthropicApiKey')!;
    expect(raw).not.toContain('sk-ant-secret');   // never cleartext on disk
    expect(raw).toContain('__enc');
    expect(readSettings().anthropicApiKey).toBe('sk-ant-secret');
  });

  it('REFUSES to store a secret when no OS keychain exists (never cleartext)', () => {
    state.available = false;
    expect(() => writeSetting('gmailRefreshToken', 'refresh-token-value'))
      .toThrow(SecretStorageUnavailableError);
    expect(store.has('gmailRefreshToken')).toBe(false);      // nothing written
    expect([...store.values()].join()).not.toContain('refresh-token-value');
    expect(secretsAvailable()).toBe(false);
  });

  it('still stores non-secret settings without a keychain', () => {
    state.available = false;
    expect(() => writeSetting('candidateName', 'Cole')).not.toThrow();
    expect(readSettings().candidateName).toBe('Cole');
  });

  it('clearing a secret (empty string) is allowed without a keychain', () => {
    state.available = false;
    expect(() => writeSetting('gmailRefreshToken', '')).not.toThrow();
  });
});
