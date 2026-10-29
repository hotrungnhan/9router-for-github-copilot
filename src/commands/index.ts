import * as vscode from 'vscode';
import { GatewayProvider } from '../provider/gatewayProvider';
import { manageProvidersFlow, addProviderFlow, pickProvider } from './manageProviders';
import { editProfileCustomHeadersFlow } from './customHeaders';
import { parseModelTarget } from '../profiles/modelNamespace';
import { testConnectionFlow } from './testConnection';

/**
 * Register user-facing commands contributed by the extension.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  provider: GatewayProvider,
  refreshStatusBar: () => Promise<void>
): void {
  const store = provider.getProfileStore();

  context.subscriptions.push(
    // Tooltip's "Show output log" link
    vscode.commands.registerCommand('9router-for-github-copilot.showOutput', () =>
      provider.showOutput()
    ),

    // "Manage Providers" command — triggered by the
    // "Add Models..." dropdown via the managementCommand contribution,
    // or from the command palette.
    vscode.commands.registerCommand('9router-for-github-copilot.manage', () =>
      manageProvidersFlow(provider, refreshStatusBar)
    ),

    // Direct command to add a new provider profile
    vscode.commands.registerCommand('9router-for-github-copilot.addProvider', () =>
      addProviderFlow(store, provider, refreshStatusBar)
    ),

    vscode.commands.registerCommand('9router-for-github-copilot.testConnection',
      (profileId?: string) => testConnectionFlow(provider, profileId)
    ),

    // Refresh Models:
    // If >1 profiles, ask which provider to refresh (or All).
    // If 1 profile, refresh immediately.
    vscode.commands.registerCommand(
      '9router-for-github-copilot.refreshModels',
      async () => {
        const selection = await pickProvider(store, '9Router: Refresh Models', true);
        if (!selection) {
          return;
        }

        provider.invalidateModelCache(selection === 'ALL' ? undefined : selection.id);

        provider.refreshModels();
        await refreshStatusBar();
        const targetLabel = selection === 'ALL' ? 'all providers' : selection.name;
        vscode.window.setStatusBarMessage(`9Router: Refreshed models for ${targetLabel}.`, 3000);
      }
    ),

    // Edit Custom Headers:
    // If >1 profiles, prompt to pick which provider.
    // If 1 profile, open editor directly.
    vscode.commands.registerCommand(
      '9router-for-github-copilot.editCustomHeaders',
      async () => {
        const target = await pickProvider(store, '9Router: Edit Custom Headers', false);
        if (!target || target === 'ALL') {
          return;
        }

        await editProfileCustomHeadersFlow(store, target);
        provider.invalidateModelCache(target.id);
        provider.refreshModels();
        await refreshStatusBar();
      }
    ),

    // Select Inline Completion Model from fetched models
    vscode.commands.registerCommand(
      '9router-for-github-copilot.selectInlineCompletionModel',
      async () => {
        const cts = new vscode.CancellationTokenSource();
        let models: vscode.LanguageModelChatInformation[];
        try {
          models = await provider.provideLanguageModelChatInformation(
            { silent: false },
            cts.token
          );
        } finally {
          cts.dispose();
        }

        if (models.length === 0) {
          vscode.window.showWarningMessage(
            '9Router: No models available to select for inline completions.'
          );
          return;
        }

        const items = [
          {
            label: '$(sparkle) Default (First available model)',
            description: 'Automatically pick the first model from the active server',
            modelId: '',
            profileId: '',
          },
          ...models.map((model) => {
            const target = parseModelTarget(
              model.id, store.getEnabledProfiles().map((profile) => profile.id), store.getDefaultProfile().id
            );
            return {
              label: model.name || model.id,
              description: model.detail ? `(${model.detail})` : model.id,
              detail: model.id,
              modelId: target.rawModelId,
              profileId: target.profileId,
            };
          }),
        ];

        const selected = await vscode.window.showQuickPick(items, {
          title: '9Router: Select Inline Completion Model',
          placeHolder: 'Choose a model for ghost-text code completions',
        });

        if (selected === undefined) {
          return;
        }

        const config = vscode.workspace.getConfiguration('9router-for-github-copilot');
        await config.update('inlineCompletionProvider', selected.profileId, vscode.ConfigurationTarget.Global);
        await config.update(
          'inlineCompletionModel',
          selected.modelId,
          vscode.ConfigurationTarget.Global
        );

        const targetDesc = selected.modelId || 'Default (first available)';
        vscode.window.showInformationMessage(
          `9Router: Inline completion model set to: ${targetDesc}`
        );
        await refreshStatusBar();
      }
    )
  );
}
