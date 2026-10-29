import * as vscode from 'vscode';
import { GatewayProvider } from './provider/gatewayProvider';
import { GatewayInlineCompletionProvider } from './completions/inlineCompletionProvider';
import { StatusBarManager } from './status/statusBarManager';
import { registerCommands } from './commands';
import { cleanupLegacyChatLanguageModelsGroups } from './profiles/groupSync';

const STATUS_BAR_PROBE_DELAY_MS = 1500;

/**
 * Extension activation. Async so we can pull the API key + custom headers
 * out of SecretStorage (and migrate legacy plain-text settings, issue #28)
 * before registering the provider — otherwise the first model fetch races
 * the secret load and is sent unauthenticated.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new GatewayProvider(context);
  await provider.loadSecrets();

  // Clean up any stale chatLanguageModels.json entries left by earlier versions
  await cleanupLegacyChatLanguageModelsGroups((msg) => provider.log(msg));

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('9router-github-copilot', provider),

    // Experimental standalone inline (ghost-text) completions backed by the
    // inference server's /v1/completions endpoint. Registered unconditionally
    // for all files; it no-ops unless the user opts in via
    // `enableInlineCompletion`, so toggling the setting takes effect without a
    // reload. This runs alongside GitHub Copilot because VS Code doesn't expose
    // BYOK models to its own inline suggestions (issue #44).
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      new GatewayInlineCompletionProvider(provider)
    )
  );

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.name = '9Router';
  statusBar.command = '9router-for-github-copilot.refreshModels';
  statusBar.show();
  context.subscriptions.push(statusBar);

  const statusManager = new StatusBarManager(
    statusBar,
    () => provider.getStatusSnapshot()
  );
  context.subscriptions.push(
    provider.onDidChangeStatusSnapshot(() => statusManager.refresh())
  );

  const refreshStatusBar = async (): Promise<void> => {
    const cts = new vscode.CancellationTokenSource();
    try {
      await provider.provideLanguageModelChatInformation({ silent: true }, cts.token);
    } finally {
      cts.dispose();
      statusManager.refresh();
    }
  };

  // Initial silent probe shortly after activation, once VS Code has settled.
  // The timer is registered as a disposable so it can't fire into a
  // disposed provider if the extension is deactivated in the interim.
  const initialProbeTimer = setTimeout(() => {
    void refreshStatusBar();
  }, STATUS_BAR_PROBE_DELAY_MS);
  context.subscriptions.push({ dispose: () => clearTimeout(initialProbeTimer) });

  registerCommands(context, provider, refreshStatusBar);

  // Copilot Chat is built into VS Code; activate opportunistically before initial model refresh
  try {
    await vscode.extensions.getExtension('github.copilot-chat')?.activate();
  } catch {
    // Copilot Chat may not be installed or enabled
  }

  // Trigger initial model cache refresh
  provider.refreshModels();
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  // no-op
}
