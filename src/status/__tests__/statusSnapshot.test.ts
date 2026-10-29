import { test, describe } from 'bun:test';
import assert from 'node:assert/strict';
import { formatCapabilityLabels, formatContextLabel, summarizeConnections, ProfileSummary } from '../statusSnapshot';

describe('formatContextLabel', () => {
  test('formats a token count with the "ctx" suffix', () => {
    assert.equal(formatContextLabel(131_072), '131k ctx');
    assert.equal(formatContextLabel(8_192), '8.2k ctx');
    assert.equal(formatContextLabel(500), '500 ctx');
  });

  test('returns empty string for undefined / zero / negative', () => {
    assert.equal(formatContextLabel(undefined), '');
    assert.equal(formatContextLabel(0), '');
    assert.equal(formatContextLabel(-1), '');
  });
});

describe('formatCapabilityLabels', () => {
  test('returns tools and vision in stable order when both are set', () => {
    assert.deepEqual(formatCapabilityLabels({ toolCalling: true, imageInput: true }), [
      'tools',
      'vision',
    ]);
  });

  test('returns an empty array when nothing is enabled', () => {
    assert.deepEqual(formatCapabilityLabels({}), []);
    assert.deepEqual(formatCapabilityLabels({ toolCalling: false, imageInput: false }), []);
  });

  test('treats numeric toolCalling as enabled (matches LanguageModelChatCapabilities)', () => {
    assert.deepEqual(formatCapabilityLabels({ toolCalling: 16 }), ['tools']);
  });
});

describe('summarizeConnections', () => {
  const profile = (id: string, overrides: Partial<ProfileSummary> = {}): ProfileSummary => ({
    id, name: id, serverUrl: 'http://localhost:8000', enabled: true,
    modelCount: 0, connectionState: 'unknown', ...overrides,
  });

  test('disabled profiles cannot make the gateway connected or disconnected', () => {
    assert.deepEqual(summarizeConnections([
      profile('disabled', { enabled: false, connectionState: 'ok', modelCount: 2, lastSuccessfulFetchAt: 500 }),
    ]), { connection: { state: 'unknown' } });
    assert.deepEqual(summarizeConnections([
      profile('active', { connectionState: 'ok', modelCount: 1, lastSuccessfulFetchAt: 100 }),
      profile('disabled', { enabled: false, connectionState: 'error', errorMessage: 'stale error', lastSuccessfulFetchAt: 500 }),
    ]), { connection: { state: 'ok' }, lastSuccessfulFetchAt: 100 });
  });

  test('reports an empty healthy server even when a failed server has stale models', () => {
    assert.equal(summarizeConnections([
      profile('empty', { connectionState: 'noModels' }),
      profile('failed', { connectionState: 'error', modelCount: 3 }),
    ]).connection.state, 'noModels');
  });

  test('keeps a partial failure visible while another provider is connected', () => {
    assert.deepEqual(summarizeConnections([
      profile('healthy', { connectionState: 'ok', modelCount: 1, lastSuccessfulFetchAt: 200 }),
      profile('failed', { connectionState: 'error', errorMessage: 'refused', lastSuccessfulFetchAt: 100 }),
    ]), { connection: { state: 'ok', errorMessage: '[failed] refused' }, lastSuccessfulFetchAt: 200 });
  });

  test('reports error when no enabled provider has succeeded', () => {
    assert.equal(summarizeConnections([
      profile('failed', { connectionState: 'error' }), profile('unknown'),
    ]).connection.state, 'error');
  });
});
