/**
 * Helpers for turning raw OpenAI `/v1/models` entries into the shape that the
 * VS Code Copilot Chat model picker renders nicely.
 *
 * Kept as its own module so it can be unit-tested without VS Code.
 */

import { OpenAIModel } from '../api/types';
import { serverReportedContext } from '../chat/contextWindow';

/**
 * Produce a display-friendly short name for a model ID.
 *
 * Gateway-style IDs like `ocg/deepseek-v4-pro` become
 * `Deepseek V4 Pro (ocg)`. Hugging-Face-style IDs like
 * `Qwen/Qwen3-8B` also get the same treatment: `Qwen3 8B (Qwen)`.
 * IDs without a slash are prettified in-place: `gpt-4o-mini` →
 * `Gpt 4o Mini`.
 */
export function friendlyModelName(id: string): string {
  return parseModelId(id).displayName;
}

/** Parsed components of a model ID. */
export interface ParsedModelId {
  /** Provider prefix before the last `/`, or undefined if no slash. */
  provider?: string;
  /** Model portion after the last `/` (or the whole ID if no slash). */
  modelPart: string;
  /** Prettified display name: `Deepseek V4 Pro (ocg)`. */
  displayName: string;
}

/**
 * Split a model ID into provider, model part, and a human-friendly
 * display name. Converts dash-separated tokens to Title Case and
 * appends the provider in parentheses when present.
 */
export function parseModelId(id: string): ParsedModelId {
  const slash = id.lastIndexOf('/');
  let provider: string | undefined;
  let modelPart: string;

  if (slash >= 0 && slash < id.length - 1) {
    provider = id.slice(0, slash);
    modelPart = id.slice(slash + 1);
  } else {
    modelPart = id;
  }

  const prettyModel = modelPart
    .split('-')
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join(' ');

  const displayName = provider
    ? `${prettyModel} (${provider})`
    : prettyModel;

  return { provider, modelPart, displayName };
}

const FAMILY_KEYWORDS: Array<{ match: RegExp; family: string }> = [
  { match: /qwen/i, family: 'qwen' },
  { match: /llama/i, family: 'llama' },
  { match: /mistral/i, family: 'mistral' },
  { match: /mixtral/i, family: 'mixtral' },
  { match: /deepseek/i, family: 'deepseek' },
  { match: /phi/i, family: 'phi' },
  { match: /gemma/i, family: 'gemma' },
  { match: /gpt-?oss/i, family: 'gpt-oss' },
  { match: /yi[-_]/i, family: 'yi' },
  { match: /command[-_]?r/i, family: 'command-r' },
];

/**
 * Infer a VS Code `family` value from the model ID. Falls back to
 * `'9router'` so the picker still groups all gateway models together when
 * the family can't be determined.
 */
export function inferModelFamily(id: string): string {
  for (const { match, family } of FAMILY_KEYWORDS) {
    if (match.test(id)) { return family; }
  }
  return '9router';
}

/**
 * Build a short description string highlighting context size and owner.
 * Used as the `detail` shown under the model name in the picker.
 */
export function describeModel(model: OpenAIModel): string {
  const context = serverReportedContext(model);
  const parts: string[] = [];
  if (context) {
    parts.push(`${formatTokens(context)} ctx`);
  }
  if (model.owned_by && model.owned_by !== 'organization-owner') {
    parts.push(model.owned_by);
  }
  return parts.join(' • ');
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) { return `${Math.round(n / 1_000_000)}M`; }
  if (n >= 1_000) { return `${Math.round(n / 1_000)}K`; }
  return String(n);
}

// ponytail: fixed postfix list (extra-low|low|high|medium|thinking). Upgrade to dynamic server capabilities if AG standardizes.
export const AG_POSTFIX_RE = /-(extra-low|low|high|medium|thinking)$/i;
export const AG_EFFORT_SUFFIX_RE = AG_POSTFIX_RE;
const AG_EFFORT_POSTFIXES = new Set(['low', 'medium', 'high', 'extra-low']);
const AG_EFFORT_ORDER = ['low', 'medium', 'high'] as const;

/**
 * Check if a model is an Antigravity (ag) model based on owner or id.
 */
export function isAgModel(model: { id: string; owned_by?: string }): boolean {
  if (model.owned_by?.toLowerCase() === 'ag') {
    return true;
  }
  const { provider } = parseModelId(model.id);
  return provider?.toLowerCase() === 'ag';
}

/**
 * Group Antigravity (ag) models that differ only by reasoning effort postfix
 * (-low, -high, -medium, -extra-low, -thinking) into a single base model
 * (e.g. `ag/gemini-3.5-flash`, `ag/gemini-3.8-flash`) with effort `low, medium, high`.
 */
export function groupAntigravityModels(models: readonly OpenAIModel[]): OpenAIModel[] {
  const result: OpenAIModel[] = [];
  const agGroups = new Map<string, {
    baseModel: OpenAIModel;
    hasExplicitBase: boolean;
    rawIds: Set<string>;
    efforts: Set<string>;
  }>();

  for (const model of models) {
    if (!isAgModel(model)) {
      result.push(model);
      continue;
    }

    const match = model.id.match(AG_POSTFIX_RE);
    const baseId = match ? model.id.slice(0, match.index) : model.id;

    let group = agGroups.get(baseId);
    if (!group) {
      const baseModel: OpenAIModel = match
        ? { ...model, id: baseId }
        : { ...model };
      group = {
        baseModel,
        hasExplicitBase: !match,
        rawIds: new Set([model.id]),
        efforts: new Set<string>(),
      };
      agGroups.set(baseId, group);
      result.push(group.baseModel);
    } else {
      group.rawIds.add(model.id);
      if (!match && !group.hasExplicitBase) {
        Object.assign(group.baseModel, model, { id: baseId });
        group.hasExplicitBase = true;
      }
    }

    if (match) {
      const postfix = match[1].toLowerCase();
      if (AG_EFFORT_POSTFIXES.has(postfix)) {
        group.efforts.add(postfix === 'extra-low' ? 'low' : postfix);
      }
    }
  }

  for (const group of agGroups.values()) {
    group.baseModel.capabilities = {
      ...group.baseModel.capabilities,
      // An explicit empty array prevents modelInfoBuilder from inferring
      // Claude/OpenAI effort levels for plain or thinking-only AG models.
      reasoningEffort: AG_EFFORT_ORDER.filter((effort) => group.efforts.has(effort)),
      ...(group.efforts.size > 0 ? { reasoning: true, thinkingEffortSupported: true } : {}),
      agRawIds: [...group.rawIds],
    };
  }

  return result;
}

/**
 * Resolve the wire model ID sent to the inference server.
 * For Antigravity (owner `ag` or `ag/` prefix), the server encodes reasoning effort
 * into the model name suffix (e.g. `ag/gemini-3.8-flash-high`) rather than accepting
 * standard `reasoning_effort` wire parameters.
 */
export function resolveWireModelId(
  modelId: string,
  reasoningEffort: string | undefined,
  isAg: boolean,
  knownRawIds?: ReadonlySet<string>
): string {
  if (!isAg) {
    return modelId;
  }
  if (!reasoningEffort) {
    return knownRawIds?.size === 1 ? [...knownRawIds][0] : modelId;
  }
  const baseId = modelId.replace(AG_POSTFIX_RE, '');
  const candidate = `${baseId}-${reasoningEffort}`;
  if (!knownRawIds || knownRawIds.size === 0) {
    return candidate;
  }
  if (knownRawIds.has(candidate)) {
    return candidate;
  }
  if (knownRawIds.has(baseId)) {
    return baseId;
  }
  return knownRawIds.size === 1 ? [...knownRawIds][0] : candidate;
}

/**
 * Deduplicate a list of models by `id`, preserving first-seen order. Servers
 * occasionally return the same id twice (e.g. LoRA adapters sharing a base
 * model id); the picker shouldn't show duplicates.
 */
export function dedupeModels(models: readonly OpenAIModel[]): OpenAIModel[] {
  const seen = new Set<string>();
  const result: OpenAIModel[] = [];
  for (const model of models) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      result.push(model);
    }
  }
  return result;
}
