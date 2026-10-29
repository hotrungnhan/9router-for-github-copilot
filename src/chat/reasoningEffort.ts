/** Resolve the picker/caller choice before per-model and global settings. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ReasoningEffortSources {
  readonly modelConfiguration?: Record<string, unknown>;
  readonly optionsModelOptions?: Record<string, unknown>;
  readonly perModelOptions?: Record<string, unknown>;
  readonly extraModelOptions?: Record<string, unknown>;
}

/** Camel-case fields take precedence; caller options win within each spelling. */
export function pickReasoningEffort(sources: ReasoningEffortSources): ReasoningEffort | undefined {
  const candidate =
    pickString(sources.optionsModelOptions?.reasoningEffort) ??
    pickString(sources.modelConfiguration?.reasoningEffort) ??
    pickString(sources.perModelOptions?.reasoningEffort) ??
    pickString(sources.extraModelOptions?.reasoningEffort) ??
    pickString(sources.optionsModelOptions?.reasoning_effort) ??
    pickString(sources.modelConfiguration?.reasoning_effort) ??
    pickString(sources.perModelOptions?.reasoning_effort) ??
    pickString(sources.extraModelOptions?.reasoning_effort);
  if (!candidate) {
    return undefined;
  }
  const lowered = candidate.toLowerCase();
  return REASONING_EFFORT_VALUES.has(lowered) ? (lowered as ReasoningEffort) : undefined;
}

/** Supported values forwarded as `reasoning_effort`. */
const REASONING_EFFORT_VALUES: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
