import { test, describe } from 'bun:test';
import assert from 'node:assert/strict';
import { migrateToProfiles } from '../profileMigration';
import { PROFILES_SECRET_KEY, DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME } from '../profileTypes';
import { SECRET_KEYS, SecretAccessor, LegacyConfigAccessor } from '../../config/secretMigration';

function createMockSecretAccessor(initial: Record<string, string> = {}): SecretAccessor & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    get: async (key: string) => data.get(key),
    store: async (key: string, value: string) => {
      data.set(key, value);
    },
    delete: async (key: string) => {
      data.delete(key);
    },
  };
}

function createMockConfigAccessor(initial: Record<string, unknown> = {}): LegacyConfigAccessor {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    get: <T>(section: string, defaultValue: T): T => {
      return (data.get(section) as T) ?? defaultValue;
    },
    inspect: () => undefined,
    update: async () => {},
  };
}

describe('migrateToProfiles', () => {
  test('creates default profile from existing legacy secrets and settings', async () => {
    const secrets = createMockSecretAccessor({
      [SECRET_KEYS.apiKey]: 'sk-legacy-token',
      [SECRET_KEYS.customHeaders]: JSON.stringify({ 'X-Custom': 'val' }),
    });
    const config = createMockConfigAccessor({
      serverUrl: 'http://custom-host:9999/v1',
    });

    const result = await migrateToProfiles(config, secrets);
    assert.equal(result.migrated, true);
    assert.ok(result.profileCreated);
    assert.equal(result.profileCreated.id, DEFAULT_PROFILE_ID);
    assert.equal(result.profileCreated.name, DEFAULT_PROFILE_NAME);
    assert.equal(result.profileCreated.serverUrl, 'http://custom-host:9999/v1');
    assert.equal(result.profileCreated.apiKey, 'sk-legacy-token');
    assert.deepEqual(result.profileCreated.customHeaders, { 'X-Custom': 'val' });

    // Verify stored in secret blob
    const storedBlob = await secrets.get(PROFILES_SECRET_KEY);
    assert.ok(storedBlob);
    const profiles = JSON.parse(storedBlob);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].id, DEFAULT_PROFILE_ID);
  });

  test('does not overwrite existing profile blob', async () => {
    const existingProfiles = [
      {
        id: 'custom-profile',
        name: 'My Provider',
        serverUrl: 'http://localhost:8000/v1',
        enabled: true,
        createdAt: 100,
      },
    ];
    const secrets = createMockSecretAccessor({
      [PROFILES_SECRET_KEY]: JSON.stringify(existingProfiles),
      [SECRET_KEYS.apiKey]: 'should-not-override',
    });
    const config = createMockConfigAccessor({
      serverUrl: 'http://ignored:1111/v1',
    });

    const result = await migrateToProfiles(config, secrets);
    assert.equal(result.migrated, false);

    const storedBlob = await secrets.get(PROFILES_SECRET_KEY);
    assert.ok(storedBlob);
    const profiles = JSON.parse(storedBlob);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].id, 'custom-profile');
  });
});
