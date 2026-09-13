import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VENDOR_ID,
  hasChatLanguageModelsGroups,
  getChatLanguageModelsGroupsForVendor,
  getChatLanguageModelsPath,
  sanitizeChatLanguageModelsSettings,
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

  it('retrieves group names without crashing', () => {
    const groups = getChatLanguageModelsGroupsForVendor();
    assert.ok(Array.isArray(groups));
  });

  it('sanitizes effort-suffixed settings keys to base model IDs', () => {
    const raw = {
      'ag/gemini-3.7-flash-high': { reasoningEffort: 'high' },
      'ag/gemini-3.7-flash-low': { reasoningEffort: 'high' },
      'ag/gemini-3.8-flash': { reasoningEffort: 'high' },
      'ag/gemini-3.8-flash-high': { reasoningEffort: 'high' },
      'ag/claude-opus-4-6-thinking': { reasoningEffort: 'medium' },
      'openrouter/poolside/laguna-s-2.1:free': { reasoningEffort: 'high' },
    };
    const sanitized = sanitizeChatLanguageModelsSettings(raw);
    assert.deepEqual(sanitized, {
      'ag/gemini-3.7-flash': { reasoningEffort: 'high' },
      'ag/gemini-3.8-flash': { reasoningEffort: 'high' },
      'ag/claude-opus-4-6': { reasoningEffort: 'medium' },
      'openrouter/poolside/laguna-s-2.1:free': { reasoningEffort: 'high' },
    });
  });
});
