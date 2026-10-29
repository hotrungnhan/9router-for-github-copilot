import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusBar } from '../statusBarRenderer';

describe('renderStatusBar', () => {
  for (const state of ['ok', 'noModels', 'error', 'unknown'] as const) {
    test(`renders ${state} connection health`, () => {
      const icon = state === 'ok' || state === 'noModels' ? 'vm-active' : 'vm-disconnect';
      assert.equal(renderStatusBar({
        host: 'http://localhost:8000/v1', connection: { state },
      }), `$(${icon}) localhost`);
    });
  }

  test('preserves an IPv6 hostname', () => {
    assert.equal(renderStatusBar({ host: 'http://[::1]:8000', connection: { state: 'ok' } }),
      '$(vm-active) [::1]');
  });

  test('preserves the multi-provider label', () => {
    assert.equal(renderStatusBar({ host: '2 provider(s)', connection: { state: 'ok' } }),
      '$(vm-active) 2 provider(s)');
  });

  test('falls back to gateway when no host is configured', () => {
    assert.equal(renderStatusBar({ host: '', connection: { state: 'unknown' } }),
      '$(vm-disconnect) gateway');
  });
});
