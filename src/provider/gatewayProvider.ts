import * as vscode from 'vscode';
import { estimateTextTokens } from '../chat/tokenBudget';
import { diagnoseModelFetchError } from '../chat/errorDiagnostics';
import { InlineCompletionBackend } from '../completions/inlineCompletionProvider';
import {
  SessionStats,
  TokenUsage,
  accumulateUsage,
  emptySessionStats,
  recordRequest,
} from '../status/sessionStats';
import {
  ConnectionState,
  ModelSummary,
  ProfileSummary,
  StatusSnapshot,
  formatCapabilityLabels,
  formatContextLabel,
} from '../status/statusSnapshot';
import { GatewayConfig } from '../config/gatewayConfig';
import { RequestStateEvent } from './chatRequestHandler';
import { ConfigService } from './configService';
import { ProfileStore } from '../profiles/profileStore';
import { Profile } from '../profiles/profileTypes';
import { ProfileRuntime } from './profileRuntime';
import { formatExposedModelId, parseModelTarget } from '../profiles/modelNamespace';
import { promptOpenSettings } from './notifications';
import { countMessageTokens } from './vscodeParts';

export type { RequestStateEvent } from './chatRequestHandler';

const MODEL_AFFECTING_KEYS = [
  '9router-for-github-copilot.requestTimeout',
  '9router-for-github-copilot.defaultMaxTokens',
  '9router-for-github-copilot.defaultMaxOutputTokens',
  '9router-for-github-copilot.enableImageInput',
  '9router-for-github-copilot.enableToolCalling',
  '9router-for-github-copilot.modelContextWindows',
] as const;

export class GatewayProvider
  implements vscode.LanguageModelChatProvider, InlineCompletionBackend
{
  private readonly outputChannel: vscode.OutputChannel;
  private readonly configService: ConfigService;
  private readonly profileStore: ProfileStore;
  private readonly runtimes: Map<string, ProfileRuntime> = new Map();

  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  private readonly _onDidChangeRequestState = new vscode.EventEmitter<RequestStateEvent>();
  readonly onDidChangeRequestState = this._onDidChangeRequestState.event;

  private readonly _onDidChangeStatusSnapshot = new vscode.EventEmitter<void>();
  readonly onDidChangeStatusSnapshot = this._onDidChangeStatusSnapshot.event;

  private sessionStats: SessionStats = emptySessionStats();
  private lastRequest?: {
    modelId: string;
    modelName: string;
    completedAt: number;
    usage?: TokenUsage;
    profileName?: string;
  };

  constructor(context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('9Router');
    const log = (msg: string) => this.outputChannel.appendLine(msg);

    this.profileStore = new ProfileStore(context.secrets, {
      log,
      onDidUpdate: () => this.syncRuntimes(),
    });

    this.configService = new ConfigService({
      log,
      promptOpenSettings: (message) => promptOpenSettings(message, log),
    });

    context.subscriptions.push(
      this.outputChannel,
      this._onDidChangeLanguageModelChatInformation,
      this._onDidChangeRequestState,
      this._onDidChangeStatusSnapshot,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('9router-for-github-copilot')) {
          return;
        }
        this.outputChannel.appendLine('Workspace configuration changed, reloading profiles...');
        this.syncRuntimes();
        if (MODEL_AFFECTING_KEYS.some((key) => e.affectsConfiguration(key))) {
          this._onDidChangeLanguageModelChatInformation.fire();
        }
      }),
      context.secrets.onDidChange((e) => {
        if (!this.profileStore.ownsSecretKey(e.key)) {
          return;
        }
        void this.profileStore.refreshCache().catch((err: unknown) => {
          this.outputChannel.appendLine(
            `Failed to refresh profiles after secret change: ${err instanceof Error ? err.message : String(err)}`
          );
        });
      })
    );
  }

  public getProfileStore(): ProfileStore {
    return this.profileStore;
  }

  public getRuntime(profileId: string): ProfileRuntime | undefined {
    return this.runtimes.get(profileId);
  }

  public async loadSecrets(): Promise<void> {
    await this.profileStore.load();
    this.syncRuntimes();
  }

  public syncRuntimes(): void {
    const profiles = this.profileStore.getProfiles();
    const currentIds = new Set(profiles.map((p) => p.id));

    for (const [id] of this.runtimes) {
      if (!currentIds.has(id)) {
        this.runtimes.delete(id);
      }
    }

    for (const profile of profiles) {
      const effectiveApiKey = profile.apiKey ?? '';
      const effectiveUrl = profile.serverUrl;

      const effectiveProfile: Profile = {
        ...profile,
        serverUrl: effectiveUrl,
        apiKey: effectiveApiKey,
      };

      const config = this.configService.loadForProfile(
        effectiveProfile,
        effectiveApiKey
      );

      const existing = this.runtimes.get(profile.id);
      if (existing) {
        existing.update(effectiveProfile, config);
      } else {
        const runtime = new ProfileRuntime(effectiveProfile, config, {
          log: (msg) => this.outputChannel.appendLine(msg),
          showOutput: () => this.outputChannel.show(),
          onRequestState: (event) => this._onDidChangeRequestState.fire(event),
          onCompleted: (modelId, modelName, usage, p) =>
            this.recordCompletedRequest(modelId, modelName, usage, p.name),
          onStatusChanged: () => this._onDidChangeStatusSnapshot.fire(),
        });
        this.runtimes.set(profile.id, runtime);
      }
    }

    this._onDidChangeStatusSnapshot.fire();
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  public log(msg: string): void {
    this.outputChannel.appendLine(msg);
  }

  public refreshModels(): void {
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  public invalidateModelCache(profileId?: string): void {
    if (profileId) {
      this.runtimes.get(profileId)?.invalidateCache();
    } else {
      for (const runtime of this.runtimes.values()) {
        runtime.invalidateCache();
      }
    }
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const enabledProfiles = this.profileStore.getEnabledProfiles();
    if (enabledProfiles.length === 0) {
      if (!options.silent) {
        void vscode.commands.executeCommand('9router-for-github-copilot.manage');
      }
      return [];
    }

    const namespaceEnabled = enabledProfiles.length > 1;
    const errors: { profile: Profile; error: string }[] = [];
    const profileModels: Array<{ profile: Profile; models: vscode.LanguageModelChatInformation[] }> = [];

    await Promise.all(
      enabledProfiles.map(async (profile) => {
        const runtime = this.runtimes.get(profile.id);
        if (!runtime) {
          return;
        }

        const outcome = await runtime.catalog.getOrFetchModels(token);
        if (outcome.error) {
          errors.push({ profile, error: outcome.error });
        }
        profileModels.push({ profile, models: outcome.models });
      })
    );

    if (!options.silent && errors.length > 0) {
      for (const { profile, error } of errors) {
        promptOpenSettings(
          `9Router [${profile.name}]: Failed to fetch models. ${diagnoseModelFetchError(error)}`,
          (msg) => this.outputChannel.appendLine(msg)
        );
      }
    }

    // Disambiguate duplicate model names across profiles (e.g. "Qwen 2.5 Coder (Local)" vs "(Cloud)")
    const nameCounts = new Map<string, number>();
    for (const { models } of profileModels) {
      for (const m of models) {
        nameCounts.set(m.name, (nameCounts.get(m.name) ?? 0) + 1);
      }
    }

    const allModels: vscode.LanguageModelChatInformation[] = [];
    for (const { profile, models } of profileModels) {
      for (const rawModel of models) {
        const exposedId = formatExposedModelId(profile.id, rawModel.id, namespaceEnabled);
        const hasDuplicate = (nameCounts.get(rawModel.name) ?? 0) > 1;
        const displayName = hasDuplicate ? `${rawModel.name} (${profile.name})` : rawModel.name;

        allModels.push({
          ...rawModel,
          id: exposedId,
          name: displayName,
          detail: profile.name,
          tooltip: `${rawModel.tooltip ? `${rawModel.tooltip}\n\n` : ''}**Provider Profile:** ${profile.name}`,
        });
      }
    }

    return allModels;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const enabledProfiles = this.profileStore.getEnabledProfiles();
    const knownIds = enabledProfiles.map((p) => p.id);
    const defaultId = this.profileStore.getDefaultProfile().id;
    const target = parseModelTarget(model.id, knownIds, defaultId);

    const runtime = this.runtimes.get(target.profileId);
    if (!runtime) {
      throw new Error(`9Router: Profile '${target.profileId}' not found or disabled.`);
    }

    const rawModel = { ...model, id: target.rawModelId };
    return runtime.chatHandler.handle(rawModel, messages, options, progress, token);
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage
  ): Promise<number> {
    return typeof text === 'string' ? estimateTextTokens(text) : countMessageTokens(text);
  }

  private recordCompletedRequest(
    modelId: string,
    modelName: string,
    usage: TokenUsage | undefined,
    profileName: string
  ): void {
    let next = recordRequest(this.sessionStats);
    if (usage) {
      next = accumulateUsage(next, usage);
    }
    this.sessionStats = next;
    this.lastRequest = {
      modelId,
      modelName,
      completedAt: Date.now(),
      profileName,
      ...(usage ? { usage } : {}),
    };
    this._onDidChangeStatusSnapshot.fire();
  }

  public showOutput(): void {
    this.outputChannel.show();
  }

  public getStatusSnapshot(): StatusSnapshot {
    const profiles = this.profileStore.getProfiles();
    const enabledProfiles = profiles.filter((p) => p.enabled);
    const namespaceEnabled = enabledProfiles.length > 1;

    const profileSummaries: ProfileSummary[] = [];
    const allModels: ModelSummary[] = [];

    let hasAnyError = false;
    let anyErrorMessage = '';
    let hasAnySuccess = false;
    let allEmpty = true;
    let anyLastSuccessAt: number | undefined;

    for (const profile of profiles) {
      const runtime = this.runtimes.get(profile.id);
      const cached = runtime?.catalog.getCachedModels() ?? [];
      const lastError = runtime?.catalog.getLastConnectionError();
      const lastSuccess = runtime?.catalog.getLastSuccessfulFetchAt();

      if (lastSuccess && (!anyLastSuccessAt || lastSuccess > anyLastSuccessAt)) {
        anyLastSuccessAt = lastSuccess;
      }
      if (cached.length > 0) {
        allEmpty = false;
      }
      if (lastError) {
        hasAnyError = true;
        anyErrorMessage = `[${profile.name}] ${lastError}`;
      } else if (lastSuccess) {
        hasAnySuccess = true;
      }

      const connectionState: ConnectionState = lastError
        ? 'error'
        : lastSuccess === undefined
          ? 'unknown'
          : cached.length === 0
            ? 'noModels'
            : 'ok';

      profileSummaries.push({
        id: profile.id,
        name: profile.name,
        serverUrl: profile.serverUrl,
        enabled: profile.enabled,
        modelCount: cached.length,
        connectionState,
        errorMessage: lastError,
      });

      if (profile.enabled) {
        for (const m of cached) {
          const totalContext = runtime?.catalog.getContextForModel(m.id);
          const exposedId = formatExposedModelId(profile.id, m.id, namespaceEnabled);
          allModels.push({
            id: exposedId,
            name: namespaceEnabled ? `${profile.name} / ${m.name}` : m.name,
            contextLabel: formatContextLabel(totalContext),
            ...(totalContext !== undefined ? { totalContext } : {}),
            capabilityLabels: formatCapabilityLabels(m.capabilities ?? {}),
          });
        }
      }
    }

    const overallState: ConnectionState = hasAnyError && !hasAnySuccess
      ? 'error'
      : hasAnySuccess && allEmpty
        ? 'noModels'
        : hasAnySuccess
          ? 'ok'
          : 'unknown';

    const defaultProfile = this.profileStore.getDefaultProfile();
    const globalConfig = this.getDefaultConfig();

    const snapshot: StatusSnapshot = {
      host:
        profiles.length === 1
          ? defaultProfile.serverUrl
          : `${enabledProfiles.length} provider(s)`,
      connection: {
        state: overallState,
        errorMessage: anyErrorMessage || undefined,
      },
      ...(anyLastSuccessAt !== undefined ? { lastSuccessfulFetchAt: anyLastSuccessAt } : {}),
      profiles: profileSummaries,
      models: allModels,
      sessionStats: this.sessionStats,
      ...(this.lastRequest ? { lastRequest: this.lastRequest } : {}),
      features: {
        toolCalling: globalConfig.enableToolCalling,
        imageInput: globalConfig.enableImageInput,
        parallelToolCalling: globalConfig.parallelToolCalling,
        inlineCompletion: globalConfig.enableInlineCompletion,
        inlineCompletionModel: globalConfig.inlineCompletionModel,
        agentTemperature: globalConfig.agentTemperature,
      },
      now: Date.now(),
    };
    return snapshot;
  }

  private getDefaultConfig(): GatewayConfig {
    const defaultProfile = this.profileStore.getDefaultProfile();
    return this.runtimes.get(defaultProfile.id)?.getConfig()
      ?? this.configService.loadForProfile(defaultProfile);
  }

  public isInlineCompletionEnabled(): boolean {
    return this.getDefaultConfig().enableInlineCompletion;
  }

  public getInlineCompletionDebounceMs(): number {
    return this.getDefaultConfig().inlineCompletionDebounce;
  }

  public async provideInlineCompletion(
    textBefore: string,
    textAfter: string,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const targetProfileId = this.getDefaultConfig().inlineCompletionProvider?.trim();
    const firstEnabled = this.profileStore.getEnabledProfiles()[0];
    const runtime = (targetProfileId ? this.runtimes.get(targetProfileId) : undefined)
      ?? (firstEnabled ? this.runtimes.get(firstEnabled.id) : undefined);

    return runtime?.inlineCompletions.provideCompletion(textBefore, textAfter, token);
  }
}
