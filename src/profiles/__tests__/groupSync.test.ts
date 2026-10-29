import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VENDOR_ID,
  cleanupLegacyChatLanguageModelsGroups,
  getChatLanguageModelsPath,
} from '../groupSync';

describe('groupSync', () => {
  let directory: string;
  let configPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), '9router-group-sync-'));
    configPath = join(directory, 'chatLanguageModels.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('locates the user config file', () => {
    assert.equal(getChatLanguageModelsPath().endsWith('chatLanguageModels.json'), true);
  });

  it('handles a missing file without creating one', async () => {
    assert.equal(await cleanupLegacyChatLanguageModelsGroups(undefined, configPath), false);
    await assert.rejects(readFile(configPath), { code: 'ENOENT' });
  });

  it('removes only legacy 9Router groups and preserves other entries', async () => {
    const other = { vendor: 'other', models: [{ id: 'keep-me' }] };
    await writeFile(configPath, JSON.stringify([
      { vendor: VENDOR_ID, name: 'old' }, other, null, { vendor: VENDOR_ID },
    ]));
    const logs: string[] = [];
    assert.equal(await cleanupLegacyChatLanguageModelsGroups((msg) => logs.push(msg), configPath), true);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), [other, null]);
    assert.match(logs[0], /Cleaned up 2/);
    assert.equal(await cleanupLegacyChatLanguageModelsGroups(undefined, configPath), false);
  });

  for (const contents of ['invalid json', '{"vendor":"9router-github-copilot"}', '[{"vendor":"other"}]']) {
    it(`leaves unsupported or unrelated contents unchanged: ${contents}`, async () => {
      await writeFile(configPath, contents);
      assert.equal(await cleanupLegacyChatLanguageModelsGroups(undefined, configPath), false);
      assert.equal(await readFile(configPath, 'utf8'), contents);
    });
  }
});
