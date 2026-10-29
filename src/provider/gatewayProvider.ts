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
  LastRequestInfo,
  formatCapabilityLabels,
  formatContextLabel,
  summarizeConnections,
} from '../status/statusSnapshot';
import { GatewayConfig } from '../config/gatewayConfig';
import { ConfigService } from './configService';
import { ProfileStore } from '../profiles/profileStore';
import { exposeProfileModels } from '../models/profileModels';
import { ProfileRuntime } from './profileRuntime';
import { formatExposedModelId, parseModelTarget, resolveInlineProfileId } from '../profiles/modelNamespace';
import { promptOpenSettings } from './notifications';
import { countMessageTokens } from './vscodeParts';

export class GatewayProvider
  implements vscode.LanguageModelChatProvider, InlineCompletionBackend
{
  private readonly outputChannel: vscode.OutputChannel;
  private readonly configService: ConfigService;
  private readonly profileStore: ProfileStore;
  private readonly runtimes: Map<string, ProfileRuntime> = new Map();

  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  private readonly _onDidChangeStatusSnapshot = new vscode.EventEmitter<void>();
  readonly onDidChangeStatusSnapshot = this._onDidChangeStatusSnapshot.event;

  private sessionStats: SessionStats = emptySessionStats();
  private lastRequest?: LastRequestInfo;

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
      this._onDidChangeStatusSnapshot,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('9router-for-github-copilot')) {
          return;
        }
        this.outputChannel.appendLine('Workspace configuration changed, reloading profiles...');
        this.syncRuntimes();
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
  }

  private syncRuntimes(): void {
    const profiles = this.profileStore.getProfiles();
    const currentIds = new Set(profiles.map((p) => p.id));

    for (const [id] of this.runtimes) {
      if (!currentIds.has(id)) {
        this.runtimes.delete(id);
      }
    }

    for (const profile of profiles) {
      const config = this.configService.loadForProfile(profile);
      const existing = this.runtimes.get(profile.id);
      if (existing) {
        existing.update(profile, config);
      } else {
        const runtime = new ProfileRuntime(profile, config, {
          log: (msg) => this.outputChannel.appendLine(msg),
          showOutput: () => this.outputChannel.show(),
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

    const groups = await Promise.all(enabledProfiles.map(async (profile) => {
      const runtime = this.runtimes.get(profile.id);
      const outcome = runtime ? await runtime.catalog.getOrFetchModels(token) : { models: [] };
      return { profile, ...outcome };
    }));

    if (token.isCancellationRequested) {
      return [];
    }
    if (!options.silent) {
      for (const { profile, error } of groups) {
        if (error) {
          promptOpenSettings(
            `9Router [${profile.name}]: Failed to fetch models. ${diagnoseModelFetchError(error)}`,
            (msg) => this.outputChannel.appendLine(msg)
          );
        }
      }
    }
    return exposeProfileModels(groups);
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
    if (!runtime || !runtime.profile.enabled) {
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

    for (const profile of profiles) {
      const runtime = this.runtimes.get(profile.id);
      const cached = runtime?.catalog.getCachedModels() ?? [];
      const lastError = runtime?.catalog.getLastConnectionError();
      const lastSuccess = runtime?.catalog.getLastSuccessfulFetchAt();

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
        lastSuccessfulFetchAt: lastSuccess,
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

    const defaultProfile = this.profileStore.getDefaultProfile();
    const globalConfig = this.getDefaultConfig();

    return {
      host:
        profiles.length === 1
          ? defaultProfile.serverUrl
          : `${enabledProfiles.length} provider(s)`,
      ...summarizeConnections(profileSummaries),
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
    const targetProfileId = resolveInlineProfileId(
      this.profileStore.getProfiles(),
      this.getDefaultConfig().inlineCompletionProvider
    );
    const runtime = targetProfileId ? this.runtimes.get(targetProfileId) : undefined;

    return runtime?.inlineCompletions.provideCompletion(textBefore, textAfter, token);
  }
}
