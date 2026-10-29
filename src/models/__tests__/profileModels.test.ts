import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import type { LanguageModelChatInformation } from 'vscode';
import { exposeProfileModels, ProfileModels } from '../profileModels';
import { createDefaultProfile } from '../../profiles/profileTypes';

function group(id: string, name: string, modelIds: string[] = ['model']): ProfileModels {
  return {
    profile: createDefaultProfile({ id, name }),
    models: modelIds.map((modelId) => ({
      id: modelId, name: 'Shared name', tooltip: 'Backend metadata', maxInputTokens: 8192,
    } as LanguageModelChatInformation)),
  };
}

describe('exposeProfileModels', () => {
  test('keeps a single provider model ID unchanged, including upstream prefixes', () => {
    const models = exposeProfileModels([group('local', 'Local', ['openai/model'])]);
    assert.equal(models[0].id, 'openai/model');
    assert.equal(models[0].name, 'Shared name');
    assert.equal(models[0].maxInputTokens, 8192);
    assert.equal(models[0].detail, 'Local');
    assert.match(String(models[0].tooltip), /Backend metadata/);
    assert.match(String(models[0].tooltip), /Provider Profile:\*\* Local/);
  });

  test('namespaces duplicates and preserves profile order without mutating cached models', () => {
    const first = group('first', 'First');
    const second = group('second', 'Second');
    const models = exposeProfileModels([first, second]);
    assert.deepEqual(models.map((model) => model.id), ['first/model', 'second/model']);
    assert.deepEqual(models.map((model) => model.name), ['Shared name (First)', 'Shared name (Second)']);
    assert.equal(first.models[0].id, 'model');
    assert.equal(first.models[0].name, 'Shared name');
  });

  test('keeps namespaces when another enabled provider has no models', () => {
    assert.equal(exposeProfileModels([group('local', 'Local'), group('empty', 'Empty', [])])[0].id, 'local/model');
  });

  test('returns no models when no providers are enabled', () => {
    assert.deepEqual(exposeProfileModels([]), []);
  });
});
