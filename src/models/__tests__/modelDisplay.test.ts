import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeModels,
  describeModel,
  friendlyModelName,
  groupAntigravityModels,
  inferModelFamily,
  isAgModel,
  parseModelId,
  resolveWireModelId,
} from '../modelDisplay';

describe('parseModelId', () => {
  test('splits provider and model part', () => {
    const parsed = parseModelId('ocg/deepseek-v4-pro');
    assert.equal(parsed.provider, 'ocg');
    assert.equal(parsed.modelPart, 'deepseek-v4-pro');
  });

  test('no slash — no provider', () => {
    const parsed = parseModelId('gpt-4o-mini');
    assert.equal(parsed.provider, undefined);
    assert.equal(parsed.modelPart, 'gpt-4o-mini');
  });

  test('produces title-cased display name with provider', () => {
    assert.equal(
      parseModelId('cx/gpt-5.6-sol').displayName,
      'Gpt 5.6 Sol (cx)'
    );
    assert.equal(
      parseModelId('ocg/deepseek-v4-pro').displayName,
      'Deepseek V4 Pro (ocg)'
    );
  });
});

describe('friendlyModelName', () => {
  test('pretty-prints gateway-style IDs with provider', () => {
    assert.equal(friendlyModelName('cx/gpt-5.6-sol'), 'Gpt 5.6 Sol (cx)');
    assert.equal(friendlyModelName('ocg/deepseek-v4-pro'), 'Deepseek V4 Pro (ocg)');
  });

  test('pretty-prints Hugging-Face org prefix with provider', () => {
    assert.equal(friendlyModelName('Qwen/Qwen3-8B'), 'Qwen3 8B (Qwen)');
    assert.equal(friendlyModelName('meta-llama/Llama-3.1-8B-Instruct'), 'Llama 3.1 8B Instruct (meta-llama)');
  });

  test('pretty-prints slashless IDs in title case', () => {
    assert.equal(friendlyModelName('gpt-4o-mini'), 'Gpt 4o Mini');
  });

  test('handles trailing slash without breaking', () => {
    const parsed = parseModelId('foo/');
    assert.equal(parsed.provider, undefined);
    assert.equal(parsed.modelPart, 'foo/');
  });
});

describe('inferModelFamily', () => {
  test('detects known families', () => {
    assert.equal(inferModelFamily('Qwen/Qwen3-8B'), 'qwen');
    assert.equal(inferModelFamily('meta-llama/Llama-3.1-8B-Instruct'), 'llama');
    assert.equal(inferModelFamily('mistralai/Mistral-7B'), 'mistral');
    assert.equal(inferModelFamily('deepseek-ai/DeepSeek-V3'), 'deepseek');
  });

  test('falls back to 9router for unknown models', () => {
    assert.equal(inferModelFamily('unknown-vendor/UnknownModel'), '9router');
  });
});

describe('describeModel', () => {
  test('uses max_model_len when present', () => {
    const detail = describeModel({
      id: 'x', object: 'model', created: 0, owned_by: 'vllm', max_model_len: 32768,
    });
    assert.ok(detail.includes('33K ctx'));
    assert.ok(detail.includes('vllm'));
  });

  test('falls back to context_length', () => {
    const detail = describeModel({
      id: 'x', object: 'model', created: 0, owned_by: 'ollama', context_length: 8192,
    });
    assert.ok(detail.includes('8K ctx'));
  });

  test('omits context when no size is reported', () => {
    const detail = describeModel({ id: 'x', object: 'model', created: 0, owned_by: 'whoever' });
    assert.ok(!detail.includes('ctx'));
    assert.ok(detail.includes('whoever'));
  });
});

describe('dedupeModels', () => {
  test('removes duplicate ids, preserving first-seen order', () => {
    const models = [
      { id: 'a', object: 'model', created: 0, owned_by: 'x' },
      { id: 'b', object: 'model', created: 0, owned_by: 'x' },
      { id: 'a', object: 'model', created: 0, owned_by: 'y' },
    ];
    const result = dedupeModels(models);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((m) => m.id), ['a', 'b']);
  });

  test('returns the same list when all ids are unique', () => {
    const models = [
      { id: 'a', object: 'model', created: 0, owned_by: 'x' },
      { id: 'b', object: 'model', created: 0, owned_by: 'x' },
    ];
    const result = dedupeModels(models);
    assert.equal(result.length, 2);
  });
});

describe('isAgModel', () => {
  test('recognises owned_by "ag"', () => {
    assert.equal(isAgModel({ id: 'gemini-3.8-flash', owned_by: 'ag' }), true);
    assert.equal(isAgModel({ id: 'gemini-3.8-flash', owned_by: 'AG' }), true);
  });

  test('recognises ag/ provider prefix', () => {
    assert.equal(isAgModel({ id: 'ag/gemini-3.8-flash' }), true);
    assert.equal(isAgModel({ id: 'ag/claude-3-5-sonnet' }), true);
  });

  test('returns false for other providers', () => {
    assert.equal(isAgModel({ id: 'openai/gpt-4o', owned_by: 'openai' }), false);
    assert.equal(isAgModel({ id: 'qwen3-8b', owned_by: 'ollama' }), false);
  });
});

describe('groupAntigravityModels', () => {
  test('groups effort-suffixed Antigravity models into a single base model', () => {
    const input = [
      {
        id: 'ag/gemini-3.8-flash-high',
        object: 'model',
        created: 0,
        owned_by: 'ag',
        capabilities: {
          vision: true,
          pdf: false,
          audioInput: true,
          videoInput: true,
          imageOutput: false,
          audioOutput: false,
          search: true,
          tools: true,
          reasoning: true,
          thinkingFormat: 'gemini-level',
          thinkingCanDisable: false,
          thinkingRange: null,
          thinkingEffortSupported: false,
          contextWindow: 1048576,
          maxOutput: 65536,
        },
        context_length: 1048576,
        max_completion_tokens: 65536,
      },
      {
        id: 'ag/gemini-3.8-flash-medium',
        object: 'model',
        created: 0,
        owned_by: 'ag',
        capabilities: {
          vision: true,
          pdf: false,
          audioInput: true,
          videoInput: true,
          imageOutput: false,
          audioOutput: false,
          search: true,
          tools: true,
          reasoning: true,
          thinkingFormat: 'gemini-level',
          thinkingCanDisable: false,
          thinkingRange: null,
          thinkingEffortSupported: false,
          contextWindow: 1048576,
          maxOutput: 65536,
        },
        context_length: 1048576,
        max_completion_tokens: 65536,
      },
      {
        id: 'ag/gemini-3.8-flash-low',
        object: 'model',
        created: 0,
        owned_by: 'ag',
        capabilities: {
          vision: true,
          pdf: false,
          audioInput: true,
          videoInput: true,
          imageOutput: false,
          audioOutput: false,
          search: true,
          tools: true,
          reasoning: true,
          thinkingFormat: 'gemini-level',
          thinkingCanDisable: false,
          thinkingRange: null,
          thinkingEffortSupported: false,
          contextWindow: 1048576,
          maxOutput: 65536,
        },
        context_length: 1048576,
        max_completion_tokens: 65536,
      },
      {
        id: 'ag/gemini-3.8-flash',
        object: 'model',
        created: 0,
        owned_by: 'ag',
        capabilities: {
          vision: true,
          pdf: false,
          audioInput: true,
          videoInput: true,
          imageOutput: false,
          audioOutput: false,
          search: true,
          tools: true,
          reasoning: true,
          thinkingFormat: 'gemini-level',
          thinkingCanDisable: false,
          thinkingRange: null,
          thinkingEffortSupported: false,
          contextWindow: 1048576,
          maxOutput: 65536,
        },
        context_length: 1048576,
        max_completion_tokens: 65536,
      },
    ];

    const grouped = groupAntigravityModels(input);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].id, 'ag/gemini-3.8-flash');
    assert.equal(grouped[0].owned_by, 'ag');
    assert.equal(grouped[0].capabilities?.reasoning, true);
    assert.deepEqual(grouped[0].capabilities?.reasoningEffort, ['high', 'low']);
    assert.equal(grouped[0].capabilities?.thinkingEffortSupported, true);
  });

  test('synthesizes base model when only suffixed variants exist', () => {
    const input = [
      {
        id: 'ag/claude-3-7-sonnet-high',
        object: 'model',
        created: 0,
        owned_by: 'ag',
      },
      {
        id: 'ag/claude-3-7-sonnet-low',
        object: 'model',
        created: 0,
        owned_by: 'ag',
      },
    ];
    const grouped = groupAntigravityModels(input);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].id, 'ag/claude-3-7-sonnet');
    assert.deepEqual(grouped[0].capabilities?.reasoningEffort, ['low', 'high']);
  });

  test('merges gemini-3.5-flash with extra-low postfix to low/medium/high efforts', () => {
    const input = [
      { id: 'ag/gemini-3.5-flash-high', object: 'model', created: 0, owned_by: 'ag' },
      { id: 'ag/gemini-3.5-flash-low', object: 'model', created: 0, owned_by: 'ag' },
      { id: 'ag/gemini-3.5-flash-extra-low', object: 'model', created: 0, owned_by: 'ag' },
    ];
    const grouped = groupAntigravityModels(input);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].id, 'ag/gemini-3.5-flash');
    assert.deepEqual(grouped[0].capabilities?.reasoningEffort, ['low', 'medium', 'high']);
  });

  test('merges claude-opus-4-6-thinking without inventing effort values', () => {
    const input = [
      { id: 'ag/claude-opus-4-6-thinking', object: 'model', created: 0, owned_by: 'ag' },
    ];
    const grouped = groupAntigravityModels(input);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].id, 'ag/claude-opus-4-6');
    assert.deepEqual(grouped[0].capabilities?.reasoningEffort, []);
  });

  test('does not invent an effort picker for plain Claude Sonnet', () => {
    const grouped = groupAntigravityModels([{
      id: 'ag/claude-sonnet-4-6',
      object: 'model',
      created: 0,
      owned_by: 'ag',
      capabilities: { reasoning: true, thinkingFormat: 'claude-adaptive' },
    }]);
    assert.deepEqual(grouped[0].capabilities?.reasoningEffort, []);
  });

  test('merges gemini-3.8-flash with gemini-3.8-flash-medium to low/medium/high efforts', () => {
    const input = [
      { id: 'ag/gemini-3.8-flash', object: 'model', created: 0, owned_by: 'ag' },
      { id: 'ag/gemini-3.8-flash-medium', object: 'model', created: 0, owned_by: 'ag' },
    ];
    const grouped = groupAntigravityModels(input);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].id, 'ag/gemini-3.8-flash');
    assert.deepEqual(grouped[0].capabilities?.reasoningEffort, ['low', 'medium', 'high']);
  });

  test('preserves non-ag models unaffected', () => {
    const input = [
      { id: 'openai/o3-mini-high', object: 'model', created: 0, owned_by: 'openai' },
      { id: 'ag/gemini-3.8-flash-high', object: 'model', created: 0, owned_by: 'ag' },
      { id: 'ag/gemini-3.8-flash-low', object: 'model', created: 0, owned_by: 'ag' },
    ];
    const grouped = groupAntigravityModels(input);
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].id, 'openai/o3-mini-high');
    assert.equal(grouped[1].id, 'ag/gemini-3.8-flash');
  });
});

describe('resolveWireModelId', () => {
  test('appends reasoning effort to base AG model ID', () => {
    assert.equal(resolveWireModelId('ag/gemini-3.8-flash', 'high', true), 'ag/gemini-3.8-flash-high');
    assert.equal(resolveWireModelId('ag/gemini-3.8-flash', 'medium', true), 'ag/gemini-3.8-flash-medium');
    assert.equal(resolveWireModelId('ag/gemini-3.8-flash', 'low', true), 'ag/gemini-3.8-flash-low');
    assert.equal(resolveWireModelId('ag/gemini-3.5-flash', 'extra-low', true), 'ag/gemini-3.5-flash-extra-low');
  });

  test('replaces existing effort suffix on AG model ID', () => {
    assert.equal(resolveWireModelId('ag/gemini-3.8-flash-low', 'high', true), 'ag/gemini-3.8-flash-high');
  });

  test('falls back to single raw ID when candidate is not in knownRawIds', () => {
    const rawIds = new Set(['ag/claude-opus-4-6-thinking']);
    assert.equal(resolveWireModelId('ag/claude-opus-4-6', 'medium', true, rawIds), 'ag/claude-opus-4-6-thinking');
  });

  test('returns original model ID when not AG or effort is undefined', () => {
    assert.equal(resolveWireModelId('ag/gemini-3.8-flash', undefined, true), 'ag/gemini-3.8-flash');
    assert.equal(resolveWireModelId('openai/gpt-4o', 'high', false), 'openai/gpt-4o');
  });
});
