/**
 * Legacy chatLanguageModels.json cleanup utility.
 *
 * Notice:
 * VS Code's `chatLanguageModels.json` is meant only for native BYOK provider
 * configurations. Provider extensions managing their own profiles (like 9Router
 * and vscode-unify-chat-provider) register models directly via
 * `vscode.lm.registerLanguageModelChatProvider` and must NOT inject entries into
 * `chatLanguageModels.json`. This module cleans up any stale entries written
 * by earlier versions.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const VENDOR_ID = '9router-github-copilot';

/**
 * Locate VS Code user directory containing `chatLanguageModels.json`.
 */
export function getChatLanguageModelsPath(): string {
  const platform = process.platform;
  const userDir = platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User')
    : platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Code', 'User')
      : path.join(os.homedir(), '.config', 'Code', 'User');
  return path.join(userDir, 'chatLanguageModels.json');
}

/**
 * Check whether `chatLanguageModels.json` currently contains any groups for this vendor.
 */
export function hasChatLanguageModelsGroups(): boolean {
  try {
    const configPath = getChatLanguageModelsPath();
    if (!fs.existsSync(configPath)) {
      return false;
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return false;
    }
    return parsed.some((g) => g && typeof g === 'object' && g.vendor === VENDOR_ID);
  } catch {
    return false;
  }
}

/**
 * Clean up legacy 9Router entries from `chatLanguageModels.json`, preserving other vendors.
 */
export async function cleanupLegacyChatLanguageModelsGroups(
  log?: (msg: string) => void
): Promise<boolean> {
  try {
    const configPath = getChatLanguageModelsPath();
    if (!fs.existsSync(configPath)) {
      return false;
    }
    const raw = await fs.promises.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return false;
    }

    const remaining = parsed.filter((g) => !(g && typeof g === 'object' && g.vendor === VENDOR_ID));
    if (remaining.length !== parsed.length) {
      await fs.promises.writeFile(configPath, JSON.stringify(remaining, null, '\t'), 'utf8');
      log?.(`Cleaned up ${parsed.length - remaining.length} legacy 9Router group(s) from chatLanguageModels.json.`);
      return true;
    }
  } catch (error) {
    log?.(`Failed to clean up legacy chatLanguageModels.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  return false;
}
