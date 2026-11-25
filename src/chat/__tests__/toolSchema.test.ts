import { test, describe } from 'bun:test';
import assert from 'node:assert/strict';
import { agentToolDescription, fillMissingRequiredProperties, getDefaultForType, normalizeAgentToolArgs } from '../toolSchema';

describe('Copilot agent tools', () => {
  test('launch guidance requires task to be offered and preserves host descriptions', () => {
    for (const name of ['task', 'read_agent', 'write_agent']) {
      const description = agentToolDescription(name, 'Host instructions', true);
      assert.ok(description.startsWith('Host instructions'));
      assert.ok(description.includes('task'));
      assert.equal(agentToolDescription(name, 'Host instructions', false), 'Host instructions');
    }
    assert.equal(agentToolDescription('other', 'unchanged', true), 'unchanged');
  });

  test('removes only empty write_agent selectors without mutating input', () => {
    const args = { agent_id: 'existing-id', agent_ids: [], scope: null, message: 'continue' };
    assert.deepEqual(normalizeAgentToolArgs('write_agent', args), {
      agent_id: 'existing-id', message: 'continue',
    });
    assert.deepEqual(args.agent_ids, []);
    assert.equal(args.scope, null);
    assert.deepEqual(normalizeAgentToolArgs('write_agent', {
      agent_id: '', agent_ids: ['existing-id'], scope: '', message: 'continue',
    }), { agent_ids: ['existing-id'], message: 'continue' });
    assert.deepEqual(normalizeAgentToolArgs('write_agent', {
      agent_id: null, agent_ids: [], scope: 'children', message: 'continue',
    }), { scope: 'children', message: 'continue' });
  });

  test('does not guess recipients or convert follow-ups to launches', () => {
    const conflict = { agent_id: 'existing-id', scope: 'siblings', message: 'continue' };
    assert.deepEqual(normalizeAgentToolArgs('write_agent', conflict), conflict);
    assert.deepEqual(normalizeAgentToolArgs('write_agent', { agent_ids: [] }), {});
    const task = { agent_type: 'explore', prompt: 'inspect', description: 'Inspect code' };
    assert.equal(normalizeAgentToolArgs('task', task), task);
    assert.equal(normalizeAgentToolArgs('read_agent', conflict), conflict);
  });
});

describe('getDefaultForType', () => {
  test('returns null for null / undefined schema', () => {
    assert.equal(getDefaultForType(null), null);
    assert.equal(getDefaultForType(undefined), null);
    assert.equal(getDefaultForType({}), null);
  });

  test('returns empty string for string type', () => {
    assert.equal(getDefaultForType({ type: 'string' }), '');
  });

  test('returns 0 for number type', () => {
    assert.equal(getDefaultForType({ type: 'number' }), 0);
    assert.equal(getDefaultForType({ type: 'integer' }), 0);
  });

  test('returns false for boolean type', () => {
    assert.equal(getDefaultForType({ type: 'boolean' }), false);
  });

  test('returns empty array for array type', () => {
    assert.deepEqual(getDefaultForType({ type: 'array' }), []);
  });

  test('returns empty object for object type', () => {
    assert.deepEqual(getDefaultForType({ type: 'object' }), {});
  });

  test('returns null for null type', () => {
    assert.equal(getDefaultForType({ type: 'null' }), null);
  });

  test('respects schema.default when present', () => {
    assert.equal(getDefaultForType({ type: 'string', default: 'hi' }), 'hi');
    assert.equal(getDefaultForType({ type: 'number', default: 42 }), 42);
    assert.equal(getDefaultForType({ type: 'boolean', default: true }), true);
    assert.deepEqual(getDefaultForType({ type: 'array', default: [1, 2] }), [1, 2]);
    assert.deepEqual(getDefaultForType({ type: 'object', default: { a: 1 } }), { a: 1 });
  });

  test('returns null for union type including null', () => {
    assert.equal(getDefaultForType({ type: ['string', 'null'] }), null);
  });

  test('recurses into first non-null variant of union type', () => {
    assert.equal(getDefaultForType({ type: ['number'] }), 0);
  });

  test('returns null for unknown primitive type', () => {
    assert.equal(getDefaultForType({ type: 'unknown-type' }), null);
  });
});

describe('fillMissingRequiredProperties', () => {
  test('returns args unchanged when schema has no required array', () => {
    const args = { a: 1 };
    assert.equal(fillMissingRequiredProperties(args, {}), args);
    assert.equal(fillMissingRequiredProperties(args, null), args);
    assert.equal(fillMissingRequiredProperties(args, undefined), args);
  });

  test('returns args unchanged when required is not an array', () => {
    const args = { a: 1 };
    assert.equal(fillMissingRequiredProperties(args, { required: 'not-an-array' }), args);
  });

  test('fills missing string required property with empty string', () => {
    const result = fillMissingRequiredProperties(
      {},
      {
        required: ['name'],
        properties: { name: { type: 'string' } },
      }
    );
    assert.deepEqual(result, { name: '' });
  });

  test('fills multiple missing required properties', () => {
    const result = fillMissingRequiredProperties(
      {},
      {
        required: ['name', 'count', 'enabled'],
        properties: {
          name: { type: 'string' },
          count: { type: 'integer' },
          enabled: { type: 'boolean' },
        },
      }
    );
    assert.deepEqual(result, { name: '', count: 0, enabled: false });
  });

  test('does not overwrite existing values', () => {
    const result = fillMissingRequiredProperties(
      { name: 'provided' },
      {
        required: ['name', 'count'],
        properties: {
          name: { type: 'string' },
          count: { type: 'integer' },
        },
      }
    );
    assert.deepEqual(result, { name: 'provided', count: 0 });
  });

  test('does not mutate the original args object', () => {
    const args: Record<string, unknown> = { a: 1 };
    fillMissingRequiredProperties(args, {
      required: ['b'],
      properties: { b: { type: 'string' } },
    });
    assert.deepEqual(args, { a: 1 });
  });

  test('logs a summary when properties are filled', () => {
    const logs: string[] = [];
    fillMissingRequiredProperties(
      {},
      {
        required: ['x'],
        properties: { x: { type: 'string' } },
      },
      (m) => logs.push(m)
    );
    assert.ok(logs.some((m) => m.includes('AUTO-FILLED')));
    assert.ok(logs.some((m) => m.includes('x=')));
  });

  test('does not log when nothing was filled', () => {
    const logs: string[] = [];
    fillMissingRequiredProperties(
      { name: 'x' },
      { required: ['name'], properties: { name: { type: 'string' } } },
      (m) => logs.push(m)
    );
    assert.equal(logs.length, 0);
  });

  test('uses schema default when filling', () => {
    const result = fillMissingRequiredProperties(
      {},
      {
        required: ['mode'],
        properties: { mode: { type: 'string', default: 'auto' } },
      }
    );
    assert.deepEqual(result, { mode: 'auto' });
  });
});
