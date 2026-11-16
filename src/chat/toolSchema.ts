/**
 * Helpers for reasoning about JSON Schema tool definitions sent by VS Code.
 *
 * Used to:
 *  - pick a reasonable default value when the model omits a required arg
 *  - fill those defaults into partial tool call arguments so the downstream
 *    tool invocation doesn't crash on missing fields
 */

export function agentToolDescription(name: string, description: string, hasTask: boolean): string {
  if (!hasTask) { return description; }
  const guidance: Record<string, string> = {
    task: 'Launch new subagents with task. Use agent_type from the available agent types.',
    write_agent: 'Follow up with existing agents only; never launch an agent here. To launch, use task. Provide exactly one of agent_id, agent_ids, or scope; omit unused selectors, including empty arrays.',
    read_agent: 'Read existing agents using IDs returned by task. To launch a new agent, use task, not read_agent.',
  };
  return guidance[name] ? `${description}\n\n${guidance[name]}` : description;
}

export function normalizeAgentToolArgs(
  name: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (name !== 'write_agent') { return args; }
  const normalized = { ...args };
  // Empty selectors are placeholders, not recipients. Keep conflicting real recipients for host validation.
  for (const key of ['agent_id', 'agent_ids', 'scope']) {
    const value = normalized[key];
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete normalized[key];
    }
  }
  return normalized;
}

type SchemaLogger = (message: string) => void;

const NOOP_LOGGER: SchemaLogger = () => {
  /* no-op */
};

export interface JsonSchema {
  type?: string | string[];
  default?: unknown;
  required?: unknown;
  properties?: Record<string, JsonSchema>;
  [key: string]: unknown;
}

/**
 * Pick a default value for a JSON Schema type. Prefers `schema.default` when
 * the schema declares one, otherwise falls back to the empty value for the type.
 * Handles union types like `["string", "null"]` by choosing the first non-null
 * variant (or `null` if `"null"` is allowed).
 */
export function getDefaultForType(schema: JsonSchema | null | undefined): unknown {
  if (!schema?.type) {
    return null;
  }

  switch (schema.type) {
    case 'string':
      return schema.default ?? '';
    case 'number':
    case 'integer':
      return schema.default ?? 0;
    case 'boolean':
      return schema.default ?? false;
    case 'array':
      return schema.default ?? [];
    case 'object':
      return schema.default ?? {};
    case 'null':
      return null;
    default:
      if (Array.isArray(schema.type)) {
        if (schema.type.includes('null')) {
          return null;
        }
        for (const t of schema.type) {
          if (t !== 'null') {
            return getDefaultForType({ ...schema, type: t });
          }
        }
      }
      return null;
  }
}

/**
 * Fill in any missing required properties on a tool call argument object
 * using defaults from the tool's input schema. Returns a shallow copy; the
 * original args object is not mutated.
 */
export function fillMissingRequiredProperties(
  args: Record<string, unknown>,
  toolSchema: JsonSchema | null | undefined,
  log: SchemaLogger = NOOP_LOGGER
): Record<string, unknown> {
  if (!toolSchema?.required || !Array.isArray(toolSchema.required)) {
    return args;
  }

  const properties = toolSchema.properties ?? {};
  const filledArgs = { ...args };
  const filledProperties: string[] = [];

  for (const requiredProp of toolSchema.required) {
    if (typeof requiredProp === 'string' && !(requiredProp in filledArgs)) {
      const propSchema = properties[requiredProp];
      const defaultValue = getDefaultForType(propSchema);
      filledArgs[requiredProp] = defaultValue;
      filledProperties.push(`${requiredProp}=${JSON.stringify(defaultValue)}`);
    }
  }

  if (filledProperties.length > 0) {
    log(`  AUTO-FILLED missing required properties: ${filledProperties.join(', ')}`);
  }

  return filledArgs;
}
