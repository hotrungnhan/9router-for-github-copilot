/**
 * Model ID namespacing and parsing for multi-profile support.
 *
 * When only one profile is active, models expose raw IDs (e.g. 'qwen2.5-coder-32b')
 * to remain fully backward-compatible with settings, history, and single-provider users.
 *
 * When two or more profiles are active, models are namespaced as:
 *   `${profileId}/${rawModelId}`
 * e.g. 'local/qwen2.5-coder-32b' vs 'cloud/qwen2.5-coder-32b'.
 *
 * Incoming requests are parsed back into (profileId, rawModelId) using the
 * set of known active profile IDs.
 */

export interface ParsedModelTarget {
  readonly profileId: string;
  readonly rawModelId: string;
}

/**
 * Format a model ID for exposure to VS Code's model picker.
 *
 * Namespaces only when `namespaceEnabled` is true (i.e. more than 1 enabled profile).
 */
export function formatExposedModelId(
  profileId: string,
  rawModelId: string,
  namespaceEnabled: boolean
): string {
  return namespaceEnabled ? `${profileId}/${rawModelId}` : rawModelId;
}

/**
 * Parse an incoming model ID from VS Code back to its target profile and raw model ID.
 *
 * Resolution order:
 * 1. With multiple active profiles, if the ID starts with `${knownProfileId}/`, strip that prefix and route there.
 * 2. If no prefix matches:
 *    a. If there is an active profile with id === fallbackProfileId, route there with rawId = modelId.
 *    b. Otherwise route to the first known profile ID, or return fallbackProfileId.
 */
export function parseModelTarget(
  modelId: string,
  knownProfileIds: readonly string[],
  fallbackProfileId: string
): ParsedModelTarget {
  const trimmed = modelId.trim();
  const slashIndex = trimmed.indexOf('/');

  if (knownProfileIds.length > 1 && slashIndex > 0) {
    const candidateProfile = trimmed.slice(0, slashIndex);
    if (knownProfileIds.includes(candidateProfile)) {
      return {
        profileId: candidateProfile,
        rawModelId: trimmed.slice(slashIndex + 1),
      };
    }
  }

  // Not namespaced or candidate profile unknown — fallback
  const resolvedProfile = knownProfileIds.includes(fallbackProfileId)
    ? fallbackProfileId
    : knownProfileIds[0] ?? fallbackProfileId;

  return {
    profileId: resolvedProfile,
    rawModelId: trimmed,
  };
}

/** Explicit inline targets must be enabled; blank selects the first enabled profile. */
export function resolveInlineProfileId(
  profiles: readonly { id: string; enabled: boolean }[],
  configuredId: string | undefined
): string | undefined {
  const id = configuredId?.trim();
  return profiles.find((profile) => profile.enabled && (!id || profile.id === id))?.id;
}
