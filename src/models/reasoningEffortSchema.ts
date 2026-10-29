import type { LanguageModelConfigurationSchema } from 'vscode';
import { OpenAIModel } from '../api/types';

/**
 * Reasoning-effort levels offered in the Copilot Chat picker for the
 * different thinking formats. Mirrors what 9Router (and the upstream
 * OpenAI/Anthropic APIs it routes to) accept on `reasoning_effort`. Kept
 * as `readonly` tuples so the property is `as const`-friendly.
 */
const OPENAI_EFFORTS = ['low', 'medium', 'high'] as const;
const CLAUDE_ADAPTIVE_EFFORTS = ['low', 'medium', 'high', 'max', 'xhigh'] as const;
const CLAUDE_BUDGET_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
const DEEPSEEK_EFFORTS = ['low', 'high', 'max'] as const;

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
  // Some providers bake the reasoning tier into the model id itself
  // (e.g. `cu/claude-4.5-opus-high-thinking`). For those the picker is
  // noise — the tier is already fixed by the model entry, and the
  // upstream ignores any `reasoning_effort` we'd forward. Skip the
  // schema entirely before any format-based enum logic runs.
  if (hasReasoningTierInName(model.id)) {
    return undefined;
  }
  // Server-advertised list wins verbatim. Filters out empty strings and
  // non-string entries defensively — some servers embed the list inside
  // a wrapper object by mistake.
  const explicit = model.capabilities.reasoningEffort;
  const efforts =
    Array.isArray(explicit) && explicit.length > 0
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
      return effortSupported ? OPENAI_EFFORTS : undefined;
    case 'openai':
    case 'kimi':
    case 'minimax':
    case 'qwen':
    case 'gemini-level':
    case 'gemini-budget':
      return OPENAI_EFFORTS;
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

const REASONING_TIER_KEYWORDS = new Set([
  'low',
  'medium',
  'high',
  'extra',
  'max',
  'xhigh',
  'thinking',
  'agentic',
]);

const REASONING_TIER_TRAILING_SEGMENTS = 3;

const MODEL_SEGMENT_SPLITTER = /[-_]/;

/** Match complete tier keywords in the last three hyphen/underscore-separated segments. */
export function hasReasoningTierInName(modelId: string): boolean {
  return splitModelSegments(modelId).slice(-REASONING_TIER_TRAILING_SEGMENTS)
    .some((part) => REASONING_TIER_KEYWORDS.has(part));
}

/**
 * Split the model portion (post provider prefix) into lowercased
 * segments on `-` and `_`.
 */
function splitModelSegments(modelId: string): readonly string[] {
  const modelPart = stripProviderPrefix(modelId);
  if (modelPart.length === 0) {
    return [];
  }
  return modelPart
    .split(MODEL_SEGMENT_SPLITTER)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}
