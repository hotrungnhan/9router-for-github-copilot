/**
 * Shared data model and connection summaries for the status bar and its tooltip.
 * Pure module so formatting and aggregation can be tested without the editor.
 */

import { formatTokenCount } from './format';
import { SessionStats, TokenUsage } from './sessionStats';

export type ConnectionState = 'ok' | 'error' | 'noModels' | 'unknown';

export interface ProfileSummary {
  readonly id: string;
  readonly name: string;
  readonly serverUrl: string;
  readonly enabled: boolean;
  readonly modelCount: number;
  readonly connectionState: ConnectionState;
  readonly lastSuccessfulFetchAt?: number;
  readonly errorMessage?: string;
}

export interface ModelSummary {
  readonly id: string;
  readonly name: string;
  /** Pre-formatted context size (e.g. "131K ctx") or empty when unknown. */
  readonly contextLabel: string;
  /** Raw context window in tokens — used to compute "% of context used" bars. Undefined when the server didn't report it. */
  readonly totalContext?: number;
  /** Pre-formatted capability tags (e.g. ["tools", "vision"]). */
  readonly capabilityLabels: readonly string[];
}

export interface LastRequestInfo {
  readonly modelId: string;
  readonly modelName: string;
  readonly completedAt: number;
  readonly usage?: TokenUsage;
  readonly profileName?: string;
}

export interface FeatureFlags {
  readonly toolCalling: boolean;
  readonly imageInput: boolean;
  readonly parallelToolCalling: boolean;
  readonly inlineCompletion: boolean;
  /** Model id for inline completions; `''` means "first model from the server". */
  readonly inlineCompletionModel: string;
  readonly agentTemperature: number;
}

export interface StatusSnapshot {
  readonly host: string;
  readonly connection: { readonly state: ConnectionState; readonly errorMessage?: string };
  readonly lastSuccessfulFetchAt?: number;
  readonly profiles?: readonly ProfileSummary[];
  readonly models: readonly ModelSummary[];
  readonly sessionStats: SessionStats;
  readonly lastRequest?: LastRequestInfo;
  readonly features: FeatureFlags;
  /** Injected so relative-time output is deterministic in tests. */
  readonly now: number;
}

/**
 * Pre-format a model's context size into the short label the dialog renders
 * ("131K ctx", "8K ctx", or `''` when unknown).
 */
export function formatContextLabel(contextTokens: number | undefined): string {
  return contextTokens && contextTokens > 0 ? `${formatTokenCount(contextTokens)} ctx` : '';
}

/**
 * Pre-format a model's capabilities into short tags ("tools", "vision"). Order
 * is stable so test assertions are stable.
 */
export function formatCapabilityLabels(capabilities: {
  readonly toolCalling?: boolean | number;
  readonly imageInput?: boolean;
}): readonly string[] {
  const labels: string[] = [];
  if (capabilities.toolCalling) {
    labels.push('tools');
  }
  if (capabilities.imageInput) {
    labels.push('vision');
  }
  return labels;
}

/** Disabled profiles do not contribute to the gateway's connection health. */
export function summarizeConnections(profiles: readonly ProfileSummary[]): {
  connection: StatusSnapshot['connection'];
  lastSuccessfulFetchAt?: number;
} {
  const enabled = profiles.filter((profile) => profile.enabled);
  const healthy = enabled.filter((profile) => profile.connectionState === 'ok' || profile.connectionState === 'noModels');
  const failed = enabled.find((profile) => profile.connectionState === 'error');
  const state: ConnectionState = healthy.length > 0
    ? healthy.some((profile) => profile.modelCount > 0) ? 'ok' : 'noModels'
    : failed ? 'error' : 'unknown';
  const timestamps = enabled.flatMap((profile) => profile.lastSuccessfulFetchAt === undefined ? [] : [profile.lastSuccessfulFetchAt]);
  return {
    connection: {
      state,
      ...(failed?.errorMessage ? { errorMessage: `[${failed.name}] ${failed.errorMessage}` } : {}),
    },
    ...(timestamps.length > 0 ? { lastSuccessfulFetchAt: Math.max(...timestamps) } : {}),
  };
}
