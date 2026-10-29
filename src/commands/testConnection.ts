import * as vscode from 'vscode';
import { GatewayProvider } from '../provider/gatewayProvider';
import { Profile } from '../profiles/profileTypes';
import { pickProvider } from './manageProviders';

/** Shared by the command palette and the provider management menu. */
export async function testConnectionFlow(
  provider: GatewayProvider,
  profileId?: string
): Promise<void> {
  const store = provider.getProfileStore();
  const selection = profileId
    ? store.getProfile(profileId)
    : await pickProvider(store, '9Router: Test Connection', true);
  if (!selection) {
    return;
  }
  const profiles = selection === 'ALL' ? store.getEnabledProfiles() : [selection];
  if (profiles.length === 0) {
    void vscode.window.showWarningMessage('9Router: No enabled providers to test.');
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: '9Router: Testing provider connections...',
    cancellable: true,
  }, async (_progress, token) => {
    for (const profile of profiles) {
      if (token.isCancellationRequested) {
        break;
      }
      const runtime = provider.getRuntime(profile.id);
      if (!runtime) {
        continue;
      }
      runtime.invalidateCache();
      const outcome = await runtime.catalog.getOrFetchModels(token);
      if (token.isCancellationRequested) {
        break;
      }
      if (outcome.error) {
        await offerConnectionRepair(provider, profile, outcome.error);
      } else {
        void vscode.window.showInformationMessage(
          `9Router [${profile.name}]: Connected! Found ${outcome.models.length} model(s).`
        );
      }
    }
  });
  provider.refreshModels();
}

async function offerConnectionRepair(provider: GatewayProvider, profile: Profile, error: string): Promise<void> {
  const action = await vscode.window.showErrorMessage(
    `9Router [${profile.name}]: Connection failed. ${error}`,
    'Edit Server URL', 'Edit API Key'
  );
  const store = provider.getProfileStore();
  if (action === 'Edit Server URL') {
    const serverUrl = await vscode.window.showInputBox({
      title: `9Router [${profile.name}] — Server URL`,
      value: profile.serverUrl,
      ignoreFocusOut: true,
      validateInput: (value) => URL.canParse(value) ? undefined : 'Please enter a valid URL',
    });
    if (serverUrl) {
      await store.saveProfile({ ...profile, serverUrl: serverUrl.trim() });
    }
  } else if (action === 'Edit API Key') {
    const apiKey = await vscode.window.showInputBox({
      title: `9Router [${profile.name}] — API Key`,
      password: true,
      ignoreFocusOut: true,
    });
    if (apiKey !== undefined) {
      await store.setApiKey(profile.id, apiKey);
    }
  }
}
