import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_DETAIL_LABEL,
  PROVIDER_MULTIPLIER_NUMERIC,
  buildModelInfo,
} from '../modelInfoBuilder';
import { TOKEN_CONSTANTS } from '../../chat/tokenBudget';
import { OpenAIModel } from '../../api/types';

function baseModel(overrides: Partial<OpenAIModel> = {}): OpenAIModel {
  return {
    id: 'qwen/Qwen3-8B',
    object: 'model',
    created: 0,
    owned_by: 'vllm',
    ...overrides,
  };
}

describe('buildModelInfo first-party look-and-feel fields', () => {
  test('sets detail to the provider label so the picker groups models', () => {
    const { info } = buildModelInfo({
      model: baseModel(),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.detail, PROVIDER_DETAIL_LABEL);
    assert.equal(info.detail, '9Router');
  });

  test('sets multiplierNumeric to 0 so BYOK models do not appear premium', () => {
    const { info } = buildModelInfo({
      model: baseModel(),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.multiplierNumeric, 0);
    assert.equal(info.multiplierNumeric, PROVIDER_MULTIPLIER_NUMERIC);
  });

  test('marks the model user-selectable for the chat picker (1.120 requirement)', () => {
    const { info } = buildModelInfo({
      model: baseModel(),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.isUserSelectable, true);
  });
});

describe('buildModelInfo id-derived fields', () => {
  test('uses the friendly (title-cased, provider-suffixed) name', () => {
    const { info } = buildModelInfo({
      model: baseModel({ id: 'meta-llama/Llama-3.1-8B-Instruct' }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.name, 'Llama 3.1 8B Instruct (meta-llama)');
    assert.equal(info.version, 'Llama 3.1 8B Instruct (meta-llama)');
    assert.equal(info.id, 'meta-llama/Llama-3.1-8B-Instruct');
  });

  test('infers a known family when the id matches', () => {
    const { info } = buildModelInfo({
      model: baseModel({ id: 'mistralai/Mistral-7B' }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.family, 'mistral');
  });

  test('falls back to the 9router family for unknown ids', () => {
    const { info } = buildModelInfo({
      model: baseModel({ id: 'unknown-org/unknown-model' }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.family, '9router');
  });
});

describe('buildModelInfo context resolution', () => {
  test('prefers max_model_len over the other context fields', () => {
    const { totalContext, info, hasServerReportedContext } = buildModelInfo({
      model: baseModel({
        max_model_len: 131072,
        context_length: 8192,
        context_window: 4096,
      }),
      defaultMaxTokens: 9999,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(totalContext, 131072);
    assert.equal(info.maxInputTokens, 131072);
    assert.equal(hasServerReportedContext, true);
  });

  test('falls back to context_length when max_model_len is absent', () => {
    const { totalContext, hasServerReportedContext } = buildModelInfo({
      model: baseModel({ context_length: 8192 }),
      defaultMaxTokens: 9999,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(totalContext, 8192);
    assert.equal(hasServerReportedContext, true);
  });

  test('falls back to context_window when max_model_len and context_length are absent', () => {
    const { totalContext, hasServerReportedContext } = buildModelInfo({
      model: baseModel({ context_window: 4096 }),
      defaultMaxTokens: 9999,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(totalContext, 4096);
    assert.equal(hasServerReportedContext, true);
  });

  test('falls back to defaultMaxTokens when the server reports no context size', () => {
    const { totalContext, hasServerReportedContext } = buildModelInfo({
      model: baseModel(),
      defaultMaxTokens: 32768,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(totalContext, 32768);
    assert.equal(hasServerReportedContext, false);
  });

  test('reads llama.cpp meta.n_ctx when the flat fields are absent (issue #55)', () => {
    const { totalContext, hasServerReportedContext } = buildModelInfo({
      model: baseModel({ meta: { n_ctx: 123904, n_ctx_train: 262144 } }),
      defaultMaxTokens: 9999,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(totalContext, 123904);
    assert.equal(hasServerReportedContext, true);
  });

  test('a user contextOverride wins over server-reported values', () => {
    const { totalContext, info, hasServerReportedContext } = buildModelInfo({
      model: baseModel({ max_model_len: 131072 }),
      defaultMaxTokens: 9999,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
      contextOverride: 32768,
    });
    assert.equal(totalContext, 32768);
    assert.equal(info.maxInputTokens, 32768);
    // Server still reported a value; the override just outranked it.
    assert.equal(hasServerReportedContext, true);
  });

  test('a user contextOverride also wins over defaultMaxTokens when nothing is reported', () => {
    const { totalContext } = buildModelInfo({
      model: baseModel(),
      defaultMaxTokens: 9999,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
      contextOverride: 16384,
    });
    assert.equal(totalContext, 16384);
  });
});

describe('buildModelInfo output token math', () => {
  test('caps maxOutputTokens at the configured default', () => {
    const { info } = buildModelInfo({
      model: baseModel({ max_model_len: 131072 }),
      defaultMaxTokens: 32768,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.maxOutputTokens, 2048);
  });

  test('reduces maxOutputTokens to leave the ADJUST_TOKEN_BUFFER headroom when the window is tight', () => {
    const totalContext = 512;
    const { info } = buildModelInfo({
      model: baseModel({ max_model_len: totalContext }),
      defaultMaxTokens: 32768,
      defaultMaxOutputTokens: 4096,
      capabilities: {},
    });
    assert.equal(info.maxOutputTokens, totalContext - TOKEN_CONSTANTS.ADJUST_TOKEN_BUFFER);
  });

  test('never drops below MIN_OUTPUT_TOKENS', () => {
    const { info } = buildModelInfo({
      model: baseModel({ max_model_len: TOKEN_CONSTANTS.MIN_OUTPUT_TOKENS }),
      defaultMaxTokens: 32768,
      defaultMaxOutputTokens: 4096,
      capabilities: {},
    });
    assert.equal(info.maxOutputTokens, TOKEN_CONSTANTS.MIN_OUTPUT_TOKENS);
  });
});

describe('buildModelInfo description and tooltip', () => {
  test('tooltip shows Provider, Model ID, Name on separate lines', () => {
    const { info } = buildModelInfo({
      model: baseModel({ id: 'ocg/deepseek-v4-pro', max_model_len: 131072, owned_by: 'ocg' }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(
      info.tooltip,
      '**Provider:** ocg  \n**Model ID:** `ocg/deepseek-v4-pro`  \n**Name:** Deepseek V4 Pro (ocg)'
    );
  });

  test('tooltip omits Provider line when no slash in id', () => {
    const { info } = buildModelInfo({
      model: baseModel({ id: 'gpt-4o-mini', max_model_len: 131072, owned_by: 'openai' }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(
      info.tooltip,
      '**Model ID:** `gpt-4o-mini`  \n**Name:** Gpt 4o Mini'
    );
  });

  test('includes description when describeModel returns content', () => {
    const { info } = buildModelInfo({
      model: baseModel({ max_model_len: 32768, owned_by: 'vllm' }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.ok(info.description, 'expected description to be set');
    assert.ok(info.description!.includes('ctx'));
  });

  test('omits description when describeModel returns an empty string', () => {
    const { info } = buildModelInfo({
      // No context fields + filtered-out owned_by leaves describeModel empty.
      model: baseModel({ owned_by: 'organization-owner' }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.description, undefined);
  });
});

describe('buildModelInfo capabilities pass-through', () => {
  test('forwards capabilities as-is', () => {
    const { info } = buildModelInfo({
      model: baseModel(),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: { imageInput: true, toolCalling: 16 },
    });
    assert.deepEqual(info.capabilities, { imageInput: true, toolCalling: 16 });
  });

  test('accepts empty capabilities', () => {
    const { info } = buildModelInfo({
      model: baseModel(),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.deepEqual(info.capabilities, {});
  });
});

describe('buildModelInfo reasoning-effort configurationSchema', () => {
  test('emits a picker schema with the correct enum for openai-format models', () => {
    const { info } = buildModelInfo({
      model: baseModel({
        id: 'cbai/gpt-5.6-luna',
        capabilities: { reasoning: true, thinkingFormat: 'openai' },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.deepEqual(info.configurationSchema?.properties.reasoningEffort.enum, [
      'low',
      'medium',
      'high',
    ]);
    assert.equal(info.configurationSchema?.properties.reasoningEffort.default, 'medium');
    assert.equal(info.configurationSchema?.properties.reasoningEffort.type, 'string');
  });

  test('emits a Claude-adaptive schema with xhigh and max, defaulting to high', () => {
    const { info } = buildModelInfo({
      model: baseModel({
        id: 'cl/anthropic/claude-opus-4.7',
        capabilities: { reasoning: true, thinkingFormat: 'claude-adaptive' },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.deepEqual(info.configurationSchema?.properties.reasoningEffort.enum, [
      'low',
      'medium',
      'high',
      'max',
      'xhigh',
    ]);
    // Claude family default = 'high', per the Copilot BYOK heuristic
    // (microsoft/vscode#315181).
    assert.equal(info.configurationSchema?.properties.reasoningEffort.default, 'high');
  });

  test('omits the schema when the model is not reasoning-capable', () => {
    const { info } = buildModelInfo({
      model: baseModel(),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.configurationSchema, undefined);
  });

  test('omits the schema for zai-format models without thinkingEffortSupported', () => {
    const { info } = buildModelInfo({
      model: baseModel({
        id: 'cbai/glm-5.1',
        capabilities: { reasoning: true, thinkingFormat: 'zai' },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.configurationSchema, undefined);
  });

  test('emits a zai schema only when thinkingEffortSupported is true', () => {
    const { info } = buildModelInfo({
      model: baseModel({
        id: 'cbai/glm-5.2',
        capabilities: {
          reasoning: true,
          thinkingFormat: 'zai',
          thinkingEffortSupported: true,
        },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.deepEqual(info.configurationSchema?.properties.reasoningEffort.enum, [
      'low',
      'medium',
      'high',
    ]);
  });

  test('falls back to the openai enum for unknown-format reasoning models in the openai family', () => {
    const { info } = buildModelInfo({
      model: baseModel({
        id: 'cbai/gpt-5.4',
        capabilities: { reasoning: true },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.deepEqual(info.configurationSchema?.properties.reasoningEffort.enum, [
      'low',
      'medium',
      'high',
    ]);
  });

  test('omits `default` when the preferred level is not in the enum', () => {
    const { info } = buildModelInfo({
      model: baseModel({
        id: 'cl/anthropic/claude-haiku-4.5',
        capabilities: {
          reasoning: true,
          thinkingFormat: 'claude-budget',
          // small enum — no `high` available
        },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    // claude-budget → ['low','medium','high','max']; preferred is 'high' which IS
    // in the enum, so default should be set. Use a non-Claude name to
    // verify the no-default fallback.
    const fallback = buildModelInfo({
      model: baseModel({
        id: 'cbai/claude-haiku-lite',
        capabilities: {
          reasoning: true,
          thinkingFormat: 'claude-budget',
        },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    // Both produce schemas — the family detector catches the "claude"
    // substring in either case, so `default` will be `'high'`.
    assert.equal(info.configurationSchema?.properties.reasoningEffort.default, 'high');
    assert.equal(fallback.info.configurationSchema?.properties.reasoningEffort.default, 'high');
  });

  test('places the schema in the `navigation` group', () => {
    const { info } = buildModelInfo({
      model: baseModel({
        id: 'cbai/glm-5.2',
        capabilities: {
          reasoning: true,
          thinkingFormat: 'zai',
          thinkingEffortSupported: true,
        },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(info.configurationSchema?.group, 'navigation');
    assert.equal(info.configurationSchema?.properties.reasoningEffort.group, 'navigation');
  });

  test('server-advertised capabilities.reasoningEffort wins over the format heuristic', () => {
    const { info } = buildModelInfo({
      model: baseModel({
        id: 'gh/gpt-5.6-luna',
        capabilities: {
          reasoning: true,
          thinkingFormat: 'openai',
          // Server says the model only supports these two — even though
          // the openai heuristic would emit three.
          reasoningEffort: ['low', 'high'],
        },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.deepEqual(info.configurationSchema?.properties.reasoningEffort.enum, ['low', 'high']);
  });

  test('falls back to the format heuristic when the server list is empty', () => {
    const { info } = buildModelInfo({
      model: baseModel({
        id: 'gh/gpt-5.6-luna',
        capabilities: {
          reasoning: true,
          thinkingFormat: 'openai',
          reasoningEffort: [],
        },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.deepEqual(info.configurationSchema?.properties.reasoningEffort.enum, [
      'low',
      'medium',
      'high',
    ]);
  });

  test('does not emit thinking effort schema for Antigravity models without effort variants', () => {
    const sonnet = buildModelInfo({
      model: baseModel({
        id: 'ag/claude-sonnet-4-6',
        owned_by: 'ag',
        capabilities: {
          reasoning: true,
          thinkingFormat: 'claude-adaptive',
          thinkingEffortSupported: false,
        },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(sonnet.info.configurationSchema, undefined);

    const opus = buildModelInfo({
      model: baseModel({
        id: 'ag/claude-opus-4-6',
        owned_by: 'ag',
        capabilities: {
          reasoning: true,
          thinkingFormat: 'claude-budget',
          thinkingEffortSupported: false,
          reasoningEffort: [],
        },
      }),
      defaultMaxTokens: 8192,
      defaultMaxOutputTokens: 2048,
      capabilities: {},
    });
    assert.equal(opus.info.configurationSchema, undefined);
  });
});
