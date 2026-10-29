import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExposedModelId,
  parseModelTarget,
  resolveInlineProfileId,
} from '../modelNamespace';

describe('formatExposedModelId', () => {
  test('returns raw ID when namespaceEnabled is false (single provider)', () => {
    assert.equal(
      formatExposedModelId('default', 'qwen2.5-coder-32b', false),
      'qwen2.5-coder-32b'
    );
  });

  test('namespaces ID as profileId/rawModelId when namespaceEnabled is true (multiple providers)', () => {
    assert.equal(
      formatExposedModelId('ollama-local', 'deepseek-r1:14b', true),
      'ollama-local/deepseek-r1:14b'
    );
    assert.equal(
      formatExposedModelId('cloud-9router', 'gpt-4o', true),
      'cloud-9router/gpt-4o'
    );
  });
});

describe('parseModelTarget', () => {
  const knownProfiles = ['default', 'ollama-local', 'cloud-9router'];

  test('parses namespaced model ID matching a known profile', () => {
    const result = parseModelTarget('ollama-local/qwen2.5-coder', knownProfiles, 'default');
    assert.deepEqual(result, {
      profileId: 'ollama-local',
      rawModelId: 'qwen2.5-coder',
    });
  });

  test('preserves upstream prefixes matching the only active profile ID', () => {
    assert.deepEqual(parseModelTarget('openai/gpt-5', ['openai'], 'openai'), {
      profileId: 'openai', rawModelId: 'openai/gpt-5',
    });
  });

  test('handles model IDs containing additional slashes', () => {
    const result = parseModelTarget('cloud-9router/meta-llama/Llama-3-70b', knownProfiles, 'default');
    assert.deepEqual(result, {
      profileId: 'cloud-9router',
      rawModelId: 'meta-llama/Llama-3-70b',
    });
  });

  test('falls back to default profile when model ID is not namespaced', () => {
    const result = parseModelTarget('qwen2.5-coder-32b', knownProfiles, 'default');
    assert.deepEqual(result, {
      profileId: 'default',
      rawModelId: 'qwen2.5-coder-32b',
    });
  });

  test('falls back when prefix does not match any known profile', () => {
    const result = parseModelTarget('unknown-provider/model-x', knownProfiles, 'default');
    assert.deepEqual(result, {
      profileId: 'default',
      rawModelId: 'unknown-provider/model-x',
    });
  });

  test('uses first known profile if specified fallback is not in list', () => {
    const result = parseModelTarget('some-model', ['custom-profile'], 'default');
    assert.deepEqual(result, {
      profileId: 'custom-profile',
      rawModelId: 'some-model',
    });
  });
});

describe('resolveInlineProfileId', () => {
  const profiles = [
    { id: 'disabled', enabled: false },
    { id: 'local', enabled: true },
    { id: 'cloud', enabled: true },
  ];

  test('defaults to the first enabled provider', () => {
    assert.equal(resolveInlineProfileId(profiles, undefined), 'local');
    assert.equal(resolveInlineProfileId(profiles, '  '), 'local');
  });

  test('uses an explicit enabled provider', () => {
    assert.equal(resolveInlineProfileId(profiles, ' cloud '), 'cloud');
  });

  test('does not route a disabled or missing target to a different backend', () => {
    assert.equal(resolveInlineProfileId(profiles, 'disabled'), undefined);
    assert.equal(resolveInlineProfileId(profiles, 'missing'), undefined);
    assert.equal(resolveInlineProfileId([], ''), undefined);
  });
});
