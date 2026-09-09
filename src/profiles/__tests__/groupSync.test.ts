import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VENDOR_ID,
  hasChatLanguageModelsGroups,
  cleanupLegacyChatLanguageModelsGroups,
  getChatLanguageModelsPath,
} from '../groupSync';

describe('groupSync', () => {
  it('identifies vendor id correctly', () => {
    assert.strictEqual(VENDOR_ID, '9router-github-copilot');
  });

  it('locates user config path', () => {
    const configPath = getChatLanguageModelsPath();
    assert.ok(configPath.includes('chatLanguageModels.json'));
  });

  it('checks hasChatLanguageModelsGroups without crashing', () => {
    const hasGroups = hasChatLanguageModelsGroups();
    assert.strictEqual(typeof hasGroups, 'boolean');
  });

  it('runs cleanupLegacyChatLanguageModelsGroups without crashing', async () => {
    const result = await cleanupLegacyChatLanguageModelsGroups();
    assert.strictEqual(typeof result, 'boolean');
  });
});
