import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { CancellationToken, LanguageModelChatInformation } from 'vscode';
import { ModelCatalog } from '../modelCatalog';
import { GatewayClient } from '../../api/client';
import { GatewayConfig } from '../../config/gatewayConfig';
import { OpenAIModelsResponse } from '../../api/types';
import { DiscoveredModelInfo, ModelDiscovery } from '../../discovery/types';
import { TOKEN_CONSTANTS } from '../../chat/tokenBudget';

function fakeToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  } as unknown as CancellationToken;
}

function fakeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    serverUrl: 'http://localhost:8000',
    apiKey: '',
    requestTimeout: 60000,
    defaultMaxTokens: 128000,
    defaultMaxOutputTokens: 4096,
    enableImageInput: true,
    enableToolCalling: true,
    parallelToolCalling: true,
    agentTemperature: 0,
    verboseLogging: false,
    customHeaders: {},
    extraModelOptions: {},
    perModelOptions: {},
    modelContextWindows: {},
    enableInlineCompletion: false,
    inlineCompletionModel: '',
    inlineCompletionMaxTokens: 256,
    inlineCompletionDebounce: 300,
    inlineCompletionTimeout: 3000,
    inlineCompletionMaxPrefixChars: 4000,
    inlineCompletionMaxSuffixChars: 1000,
    ...overrides,
  };
}

function modelsResponse(...ids: Array<{ id: string; contextLen?: number }>): OpenAIModelsResponse {
  return {
    object: 'list',
    data: ids.map(({ id, contextLen }) => ({
      id,
      object: 'model',
      created: 0,
      owned_by: 'test',
      ...(contextLen !== undefined ? { max_model_len: contextLen } : {}),
    })),
  };
}

interface Harness {
  catalog: ModelCatalog;
  fetchCalls: number;
  statusChanges: number;
}

/** Discovery stub for a backend with no native metadata API. */
function noDiscovery(): ModelDiscovery {
  return {
    reset: () => undefined,
    enrichModel: () => Promise.resolve(undefined),
  };
}

function makeCatalog(options: {
  fetchModels: () => Promise<OpenAIModelsResponse>;
  config?: GatewayConfig;
  discovery?: ModelDiscovery;
}): Harness {
  const harness = { fetchCalls: 0, statusChanges: 0 } as Harness;
  const client = {
    fetchModels: () => {
      harness.fetchCalls++;
      return options.fetchModels();
    },
  } as unknown as GatewayClient;
  harness.catalog = new ModelCatalog({
    client,
    discovery: options.discovery ?? noDiscovery(),
    getConfig: () => options.config ?? fakeConfig(),
    log: () => undefined,
    onStatusChanged: () => {
      harness.statusChanges++;
    },
  });
  return harness;
}

function chatInfo(id: string, maxInputTokens = 0): LanguageModelChatInformation {
  return { id, maxInputTokens } as unknown as LanguageModelChatInformation;
}

describe('ModelCatalog.getOrFetchModels', () => {
  test('fetches, exposes models, and records a successful connection', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' }, { id: 'b' })),
    });
    const { models, error } = await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(error, undefined);
    assert.deepEqual(models.map((m) => m.id), ['a', 'b']);
    assert.deepEqual(h.catalog.getCachedModels().map((m) => m.id), ['a', 'b']);
    assert.notEqual(h.catalog.getLastSuccessfulFetchAt(), undefined);
    assert.equal(h.catalog.getLastConnectionError(), undefined);
    assert.equal(h.statusChanges, 1);
  });

  test('serves the short-lived cache instead of re-fetching', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.fetchCalls, 1);
  });

  test('re-fetches after invalidateCache', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    h.catalog.invalidateCache();
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.fetchCalls, 2);
  });

  test('concurrent callers share a single in-flight request', async () => {
    let release: (r: OpenAIModelsResponse) => void = () => undefined;
    const h = makeCatalog({
      fetchModels: () => new Promise((resolve) => { release = resolve; }),
    });
    const first = h.catalog.getOrFetchModels(fakeToken());
    const second = h.catalog.getOrFetchModels(fakeToken());
    release(modelsResponse({ id: 'a' }));
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(h.fetchCalls, 1);
    assert.deepEqual(r1.models.map((m) => m.id), ['a']);
    assert.deepEqual(r2.models.map((m) => m.id), ['a']);
  });

  test('surfaces fetch failures as an error result and records the connection error', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.reject(new Error('boom')),
    });
    const { models, error } = await h.catalog.getOrFetchModels(fakeToken());
    assert.deepEqual(models, []);
    assert.equal(error, 'boom');
    assert.equal(h.catalog.getLastConnectionError(), 'boom');
    assert.equal(h.statusChanges, 1);
  });

  test('a later success clears the recorded connection error', async () => {
    let fail = true;
    const h = makeCatalog({
      fetchModels: () =>
        fail ? Promise.reject(new Error('boom')) : Promise.resolve(modelsResponse({ id: 'a' })),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    fail = false;
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.catalog.getLastConnectionError(), undefined);
  });

  test('does not report cancellation as a connection failure', async () => {
    const token = fakeToken();
    let rejectFetch!: (error: Error) => void;
    const h = makeCatalog({
      fetchModels: () => new Promise((_resolve, reject) => { rejectFetch = reject; }),
    });
    const pending = h.catalog.getOrFetchModels(token);
    Object.assign(token, { isCancellationRequested: true });
    rejectFetch(new Error('aborted'));
    await pending;
    assert.equal(h.catalog.getLastConnectionError(), undefined);
    assert.equal(h.statusChanges, 0);
  });

  test('a cancelled caller does not receive cached models', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    assert.deepEqual(await h.catalog.getOrFetchModels(fakeToken(true)), { models: [] });
    assert.equal(h.fetchCalls, 1);
  });

  test('invalidation starts a fresh fetch and prevents stale results overwriting it', async () => {
    let release!: (response: OpenAIModelsResponse) => void;
    const h = makeCatalog({
      fetchModels: () => h.fetchCalls === 1
        ? new Promise((resolve) => { release = resolve; })
        : Promise.resolve(modelsResponse({ id: 'new', contextLen: 8192 })),
    });
    const oldFetch = h.catalog.getOrFetchModels(fakeToken());
    h.catalog.invalidateCache();
    const fresh = await h.catalog.getOrFetchModels(fakeToken());
    assert.deepEqual(fresh.models.map((m) => m.id), ['new']);
    release(modelsResponse({ id: 'old', contextLen: 2048 }));
    assert.deepEqual((await oldFetch).models, []);
    assert.equal(h.fetchCalls, 2);
    assert.deepEqual(h.catalog.getCachedModels().map((m) => m.id), ['new']);
    assert.equal(h.catalog.getContextForModel('old'), undefined);
    assert.equal(h.catalog.getContextForModel('new'), 8192);
    assert.equal(h.statusChanges, 1);
  });

  test('a stale fetch failure does not overwrite the new connection state', async () => {
    let rejectFetch!: (error: Error) => void;
    const h = makeCatalog({
      fetchModels: () => h.fetchCalls === 1
        ? new Promise((_resolve, reject) => { rejectFetch = reject; })
        : Promise.resolve(modelsResponse({ id: 'new' })),
    });
    const oldFetch = h.catalog.getOrFetchModels(fakeToken());
    h.catalog.invalidateCache();
    await h.catalog.getOrFetchModels(fakeToken());
    rejectFetch(new Error('old server unavailable'));
    await oldFetch;
    assert.equal(h.catalog.getLastConnectionError(), undefined);
    assert.equal(h.statusChanges, 1);
  });

  for (const cancel of [false, true]) {
    test(`${cancel ? 'cancellation' : 'invalidation'} during discovery prevents stale metadata publication`, async () => {
      const token = fakeToken();
      let release!: (info: DiscoveredModelInfo) => void;
      let started!: () => void;
      const discovering = new Promise<void>((resolve) => { started = resolve; });
      const h = makeCatalog({
        fetchModels: () => Promise.resolve(modelsResponse({ id: 'old' })),
        discovery: {
          reset: () => undefined,
          enrichModel: () => new Promise((resolve) => {
            release = resolve;
            started();
          }),
        },
      });
      const pending = h.catalog.getOrFetchModels(token);
      await discovering;
      if (cancel) {
        Object.assign(token, { isCancellationRequested: true });
      } else {
        h.catalog.invalidateCache();
      }
      release({ contextLength: 8192, samplerParams: { temperature: 0.5 } });
      assert.deepEqual((await pending).models, []);
      assert.deepEqual(h.catalog.getCachedModels(), []);
      assert.equal(h.catalog.getContextForModel('old'), undefined);
      assert.equal(h.catalog.getDiscoveredParams('old'), undefined);
      assert.equal(h.statusChanges, 0);
    });
  }

  test('reset clears server-specific metadata and connection state', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a', contextLen: 8192 })),
      discovery: {
        reset: () => undefined,
        enrichModel: async () => ({ samplerParams: { temperature: 0.5 } }),
      },
    });
    await h.catalog.getOrFetchModels(fakeToken());
    h.catalog.learnContextSizeFromError(chatInfo('a', 8192), new Error('maximum context length is 4096 tokens'));
    h.catalog.reset();
    assert.deepEqual(h.catalog.getCachedModels(), []);
    assert.equal(h.catalog.getContextForModel('a'), undefined);
    assert.equal(h.catalog.getDiscoveredParams('a'), undefined);
    assert.equal(h.catalog.getLastSuccessfulFetchAt(), undefined);
    assert.equal(h.catalog.getLastConnectionError(), undefined);
    assert.equal(h.catalog.resolveModelMaxContext(chatInfo('a', 16384)), 16384);
  });

  test('does not cache results from a cancelled fetch', async () => {
    const token = fakeToken();
    const h = makeCatalog({
      fetchModels: async () => {
        Object.assign(token, { isCancellationRequested: true });
        return modelsResponse({ id: 'a' });
      },
    });
    const { models } = await h.catalog.getOrFetchModels(token);
    assert.deepEqual(models, []);
    assert.equal(h.catalog.getLastSuccessfulFetchAt(), undefined);
    // Next (uncancelled) call must re-probe rather than see a stale empty list.
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.fetchCalls, 2);
    assert.equal(h.catalog.getCachedModels().length, 1);
  });
});

describe('ModelCatalog discovery integration', () => {
  function fixedDiscovery(byId: Record<string, DiscoveredModelInfo>): ModelDiscovery {
    return {
      reset: () => undefined,
      enrichModel: (modelId) => Promise.resolve(byId[modelId]),
    };
  }

  test('discovered context wins over defaultMaxTokens and feeds the chat budget', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
      discovery: fixedDiscovery({
        a: { contextLength: 65536, contextSource: 'Ollama num_ctx (/api/show)', samplerParams: {} },
      }),
    });
    const { models } = await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(models[0].maxInputTokens, 65536);
    assert.equal(h.catalog.getContextForModel('a'), 65536);
  });

  test('exposes discovered sampler params to the chat path', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
      discovery: fixedDiscovery({
        a: { samplerParams: { temperature: 0.7, top_p: 0.8 } },
      }),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    assert.deepEqual(h.catalog.getDiscoveredParams('a'), { temperature: 0.7, top_p: 0.8 });
    assert.equal(h.catalog.getDiscoveredParams('unknown'), undefined);
  });

  test('discovered capability verdicts gate tool/vision support', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
      discovery: fixedDiscovery({
        a: { samplerParams: {}, toolsSupported: false, visionSupported: false },
      }),
    });
    const { models } = await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(models[0].capabilities?.toolCalling, false);
    assert.equal(models[0].capabilities?.imageInput, false);
  });

  test('unknown capability verdicts (undefined) keep the settings-driven defaults', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a' })),
      discovery: fixedDiscovery({ a: { samplerParams: {} } }),
    });
    const { models } = await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(models[0].capabilities?.toolCalling, true);
    assert.equal(models[0].capabilities?.imageInput, true);
  });

  test('a re-fetch drops discovered data for models the server removed', async () => {
    let ids = [{ id: 'a' }, { id: 'b' }];
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse(...ids)),
      discovery: fixedDiscovery({
        a: { samplerParams: { top_p: 0.9 } },
        b: { samplerParams: { top_p: 0.5 } },
      }),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    assert.ok(h.catalog.getDiscoveredParams('b'));
    ids = [{ id: 'a' }];
    h.catalog.invalidateCache();
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.catalog.getDiscoveredParams('b'), undefined);
  });
});

describe('ModelCatalog.resolveModelMaxContext', () => {
  test('prefers the server-reported context recorded during the fetch', async () => {
    const h = makeCatalog({
      fetchModels: () => Promise.resolve(modelsResponse({ id: 'a', contextLen: 2048 })),
    });
    await h.catalog.getOrFetchModels(fakeToken());
    assert.equal(h.catalog.getContextForModel('a'), 2048);
    assert.equal(h.catalog.resolveModelMaxContext(chatInfo('a', 999999)), 2048);
  });

  test('falls back to the picker-facing maxInputTokens before any fetch', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    assert.equal(h.catalog.resolveModelMaxContext(chatInfo('a', 4096)), 4096);
  });

  test('falls back to the default context when nothing is known', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    assert.equal(
      h.catalog.resolveModelMaxContext(chatInfo('a')),
      TOKEN_CONSTANTS.DEFAULT_CONTEXT_TOKENS
    );
  });
});

describe('ModelCatalog.learnContextSizeFromError', () => {
  test('learns a smaller context from an overflow error and applies it', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    const model = chatInfo('a', 8192);
    const learned = h.catalog.learnContextSizeFromError(
      model,
      new Error("This model's maximum context length is 4096 tokens. However, you requested 5000 tokens.")
    );
    assert.equal(learned, true);
    assert.equal(h.catalog.resolveModelMaxContext(model), 4096);
  });

  test('ignores unrelated errors', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    assert.equal(
      h.catalog.learnContextSizeFromError(chatInfo('a', 8192), new Error('connection refused')),
      false
    );
  });

  test('returns false when the reported context is not smaller than the current budget', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    const model = chatInfo('a', 4096);
    const learned = h.catalog.learnContextSizeFromError(
      model,
      new Error('maximum context length is 8192 tokens')
    );
    assert.equal(learned, false);
    assert.equal(h.catalog.resolveModelMaxContext(model), 4096);
  });

  test('clearLearnedContexts reverts to the advertised size', () => {
    const h = makeCatalog({ fetchModels: () => Promise.resolve(modelsResponse()) });
    const model = chatInfo('a', 8192);
    h.catalog.learnContextSizeFromError(model, new Error('maximum context length is 4096 tokens'));
    assert.equal(h.catalog.resolveModelMaxContext(model), 4096);
    h.catalog.clearLearnedContexts();
    assert.equal(h.catalog.resolveModelMaxContext(model), 8192);
  });
});
