/**
 * Build the `LanguageModelChatInformation` object that VS Code's model picker
 * renders. Kept as its own module so the picker-facing shape (especially the
 * first-party-style `detail`/`multiplierNumeric` fields) can be unit-tested
 * without standing up the full provider.
 */

import type { LanguageModelConfigurationSchema } from 'vscode';
import { OpenAIModel } from '../api/types';
import { describeModel, friendlyModelName, inferModelFamily, parseModelId } from './modelDisplay';
import { serverReportedContext } from '../chat/contextWindow';
import { TOKEN_CONSTANTS } from '../chat/tokenBudget';
import { resolveReasoningEffortSchema } from './reasoningEffortSchema';

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

  const tooltip = [
    provider && `**Provider:** ${provider}`,
    `**Model ID:** \`${model.id}\``,
    `**Name:** ${friendlyName}`,
  ].filter(Boolean).join('  \n');

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
