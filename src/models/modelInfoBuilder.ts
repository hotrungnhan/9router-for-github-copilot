/**
 * Build the `LanguageModelChatInformation` object that VS Code's model picker
 * renders. Kept as its own module so the picker-facing shape (especially the
 * first-party-style `detail`/`multiplierNumeric` fields) can be unit-tested
 * without standing up the full provider.
 */

import type { LanguageModelConfigurationSchema } from 'vscode';
import { OpenAIModel } from '../api/types';
import { describeModel, friendlyModelName, inferModelFamily, isAgModel, parseModelId } from './modelDisplay';
import { serverReportedContext } from '../chat/contextWindow';
import { TOKEN_CONSTANTS } from '../chat/tokenBudget';

/**
 * Grey right-hand label rendered in the VS Code chat model picker. Matches the
 * shape native Copilot Chat BYOK providers use (e.g. `detail: 'Anthropic'`),
 * which is what visually groups all of our models under the provider.
 */
export const PROVIDER_DETAIL_LABEL = '9Router';

/**
 * Cost-tier multiplier surfaced to Copilot Chat. Set to 0 so BYOK / self-hosted
 * models don't appear to consume Copilot premium request quota.
 */
export const PROVIDER_MULTIPLIER_NUMERIC = 0;

/**
 * Reasoning-effort levels offered in the Copilot Chat picker for the
 * different thinking formats. Mirrors what 9Router (and the upstream
 * OpenAI/Anthropic APIs it routes to) accept on `reasoning_effort`. Kept
 * as `readonly` tuples so the property is `as const`-friendly.
 */
const OPENAI_EFFORTS = ['low', 'medium', 'high'] as const;
const CLAUDE_ADAPTIVE_EFFORTS = ['low', 'medium', 'high', 'max', 'xhigh'] as const;
const CLAUDE_BUDGET_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
const DEEPSEEK_EFFORTS = ['high', 'max'] as const;
const ZAI_EFFORTS = ['low', 'medium', 'high'] as const;
const KIMI_EFFORTS = ['low', 'medium', 'high'] as const;
const MINIMAX_EFFORTS = ['low', 'medium', 'high'] as const;
const QWEN_EFFORTS = ['low', 'medium', 'high'] as const;
const GEMINI_EFFORTS = ['low', 'medium', 'high'] as const;

export interface ModelCapabilities {
  readonly imageInput?: boolean;
  readonly toolCalling?: boolean | number;
}

export interface BuildModelInfoInput {
  readonly model: OpenAIModel;
  readonly defaultMaxTokens: number;
  readonly defaultMaxOutputTokens: number;
  readonly capabilities: ModelCapabilities;
  /**
   * User-configured context window for this model (from the
   * `modelContextWindows` setting). Wins over everything else.
   */
  readonly contextOverride?: number;
  /**
   * Context discovered from the backend (Ollama `/api/show`: runtime
   * `num_ctx`, else the model's trained context length). Sits below the user
   * override but above the OpenAI `/v1/models` value, which Ollama omits.
   */
  readonly discoveredContext?: number;
}

/**
 * Picker-facing fields plus the resolved total context size. Total context is
 * returned separately because the chat-response path uses it to budget output
 * tokens — relying on `maxInputTokens` alone would double-count.
 */
export interface BuildModelInfoResult {
  readonly info: {
    readonly id: string;
    readonly name: string;
    readonly family: string;
    readonly version: string;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly capabilities: ModelCapabilities;
    readonly detail: string;
    readonly tooltip: string;
    readonly description?: string;
    readonly isUserSelectable: true;
    readonly multiplierNumeric: number;
    /**
     * Sub-picker schema for the Copilot Chat model picker. Populated when
     * the model advertises (or we heuristically infer) supported reasoning
     * effort levels — drives the "Thinking Effort" dropdown that landed in
     * microsoft/vscode#315181. The chosen value flows into
     * `options.modelConfiguration.reasoningEffort` on the chat request.
     */
    readonly configurationSchema?: LanguageModelConfigurationSchema;
  };
  readonly totalContext: number;
  readonly hasServerReportedContext: boolean;
}

/**
 * Translate a raw `/v1/models` entry into the picker-facing model info plus
 * the resolved total context.
 *
 * `maxInputTokens` is intentionally set to the full server-reported context so
 * the picker shows the true window size. Output-token budgeting uses
 * `totalContext` separately so the math doesn't double-count.
 */
export function buildModelInfo({
  model,
  defaultMaxTokens,
  defaultMaxOutputTokens,
  capabilities,
  contextOverride,
  discoveredContext,
}: BuildModelInfoInput): BuildModelInfoResult {
  const serverContext = serverReportedContext(model);
  const totalContext =
    contextOverride ?? discoveredContext ?? serverContext ?? defaultMaxTokens;
  // 9Router `capabilities.maxOutput` is an authoritative ceiling (issue #199).
  const modelMaxOutput = model.capabilities?.maxOutput;
  const computedMaxOutput = Math.min(
    defaultMaxOutputTokens,
    Math.max(
      TOKEN_CONSTANTS.MIN_OUTPUT_TOKENS,
      totalContext - TOKEN_CONSTANTS.ADJUST_TOKEN_BUFFER
    )
  );
  const maxOutputTokens = modelMaxOutput !== undefined && modelMaxOutput > 0
    ? Math.min(modelMaxOutput, computedMaxOutput)
    : computedMaxOutput;

  const description = describeModel(model);
  const { provider } = parseModelId(model.id);
  const friendlyName = friendlyModelName(model.id);

  const tooltipParts: string[] = [];
  if (provider) {
    tooltipParts.push(`**Provider:** ${provider}`);
  }
  tooltipParts.push(`**Model ID:** \`${model.id}\``);
  tooltipParts.push(`**Name:** ${friendlyName}`);
  const tooltip = tooltipParts.join('  \n');

  // Build the "Thinking Effort" sub-picker for reasoning-capable models.
  // The schema follows microsoft/vscode#315181: the picker renders a
  // dropdown of `enum` values with the `default` pre-selected, and the
  // chosen value arrives on the request as
  // `options.modelConfiguration.reasoningEffort`.
  const configurationSchema = resolveReasoningEffortSchema(model, friendlyName);

  const info: BuildModelInfoResult['info'] = {
    id: model.id,
    name: friendlyName,
    family: inferModelFamily(model.id),
    version: friendlyName,
    maxInputTokens: totalContext,
    maxOutputTokens,
    capabilities,
    detail: PROVIDER_DETAIL_LABEL,
    tooltip,
    isUserSelectable: true,
    multiplierNumeric: PROVIDER_MULTIPLIER_NUMERIC,
    ...(description ? { description } : {}),
    ...(configurationSchema ? { configurationSchema } : {}),
  };

  return {
    info,
    totalContext,
    hasServerReportedContext: serverContext !== undefined,
  };
}

/**
 * Build the `configurationSchema` for a model when it advertises reasoning
 * support. Mirrors the Copilot Chat BYOK behaviour in
 * microsoft/vscode#315181: a `reasoningEffort` string enum with a sensible
 * default. Returns `undefined` when the model doesn't support thinking,
 * so the picker doesn't render an empty dropdown.
 */
export function resolveReasoningEffortSchema(
  model: OpenAIModel,
  friendlyName: string
): LanguageModelConfigurationSchema | undefined {
  if (!model.capabilities?.reasoning) {
    return undefined;
  }
  // Antigravity models only expose reasoning efforts when actual effort variants existed
  if (isAgModel(model) && (!model.capabilities.reasoningEffort || model.capabilities.reasoningEffort.length === 0)) {
    return undefined;
  }
  // Server-advertised list wins verbatim. Filters out empty strings and
  // non-string entries defensively — some servers embed the list inside
  // a wrapper object by mistake.
  const explicit = model.capabilities.reasoningEffort;
  const efforts = Array.isArray(explicit) && explicit.length > 0
    ? explicit.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : pickEffortsForFormat(model);
  if (!efforts || efforts.length === 0) {
    return undefined;
  }
  const defaultEffort = pickDefaultEffort(friendlyName, model.id, efforts);
  return {
    group: 'navigation',
    properties: {
      reasoningEffort: {
        type: 'string',
        enum: efforts,
        // Drop `default` when the preferred value isn't in the supported
        // list, so the picker falls back to "no selection" instead of
        // emitting an out-of-range default.
        ...(defaultEffort !== undefined ? { default: defaultEffort } : {}),
        description: 'Reasoning effort forwarded to the model as `reasoning_effort`.',
        group: 'navigation',
      },
    },
  };
}

function pickDefaultEffort(
  friendlyName: string,
  modelId: string,
  efforts: readonly string[]
): string | undefined {
  // Claude family uses `high` as the preferred default per the upstream
  // Copilot BYOK heuristic in microsoft/vscode#315181. Everything else
  // uses `medium`. Strip the "Claude" provider suffix from the friendly
  // name so `claude-opus-4.7 (anthropic)` still matches.
  const lower = friendlyName.toLowerCase();
  const isClaude = /(^|\s)claude(\s|$|[-_])/.test(lower) || /claude/i.test(modelId);
  const preferred = isClaude ? 'high' : 'medium';
  return efforts.includes(preferred) ? preferred : undefined;
}

function pickEffortsForFormat(
  model: OpenAIModel
): readonly string[] | undefined {
  const format = model.capabilities?.thinkingFormat;
  const effortSupported = model.capabilities?.thinkingEffortSupported === true;
  switch (format) {
    case 'openai':
      return OPENAI_EFFORTS;
    case 'claude-adaptive':
      return CLAUDE_ADAPTIVE_EFFORTS;
    case 'claude-budget':
      return CLAUDE_BUDGET_EFFORTS;
    case 'deepseek':
      return DEEPSEEK_EFFORTS;
    case 'zai':
      // Only GLM-5.2+ reads `reasoning_effort` (9Router capabilities.js
      // gate it on `thinkingEffortSupported`); older zai-format models
      // ignore the field.
      return effortSupported ? ZAI_EFFORTS : undefined;
    case 'kimi':
      return KIMI_EFFORTS;
    case 'minimax':
      return MINIMAX_EFFORTS;
    case 'qwen':
      return QWEN_EFFORTS;
    case 'gemini-level':
    case 'gemini-budget':
      return GEMINI_EFFORTS;
    case undefined:
      // No explicit format — fall back to a model-id hint for the
      // openai family (gpt-5, o-series, codex) which is the most common
      // reason-capable model without a tagged format.
      if (/^(o1|o3|o4|gpt-5|codex)/i.test(stripProviderPrefix(model.id))) {
        return OPENAI_EFFORTS;
      }
      return undefined;
    default:
      return undefined;
  }
}

function stripProviderPrefix(modelId: string): string {
  const slash = modelId.lastIndexOf('/');
  return slash >= 0 && slash < modelId.length - 1 ? modelId.slice(slash + 1) : modelId;
}
