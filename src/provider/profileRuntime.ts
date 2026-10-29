/**
 * ProfileRuntime encapsulates the execution pipeline for a single profile:
 * - GatewayClient (HTTP connection, baseUrl, auth headers)
 * - ModelDiscovery (backend probing, e.g. Ollama)
 * - ModelCatalog (model caching, context learning)
 * - ChatRequestHandler (message conversion, streaming, retry)
 * - InlineCompletionService (ghost-text completions)
 *
 * Owned and managed by GatewayProvider, one runtime per configured profile.
 */

import { isDeepStrictEqual } from 'node:util';
import { GatewayClient } from '../api/client';
import { GatewayConfig } from '../config/gatewayConfig';
import { Profile } from '../profiles/profileTypes';
import { ModelCatalog } from './modelCatalog';
import { OllamaDiscovery } from '../discovery/ollamaDiscovery';
import { ChatRequestHandler } from './chatRequestHandler';
import { InlineCompletionService } from './inlineCompletionService';
import { TokenUsage } from '../status/sessionStats';

export interface ProfileRuntimeDeps {
  log: (msg: string) => void;
  showOutput: () => void;
  onCompleted: (modelId: string, modelName: string, usage: TokenUsage | undefined, profile: Profile) => void;
  onStatusChanged: () => void;
}

export class ProfileRuntime {
  public readonly client: GatewayClient;
  public readonly discovery: OllamaDiscovery;
  public readonly catalog: ModelCatalog;
  public readonly chatHandler: ChatRequestHandler;
  public readonly inlineCompletions: InlineCompletionService;
  private currentConfig: GatewayConfig;

  constructor(
    public profile: Profile,
    initialConfig: GatewayConfig,
    private readonly deps: ProfileRuntimeDeps
  ) {
    this.currentConfig = initialConfig;
    const log = (msg: string) => this.deps.log(`[${this.profile.name}] ${msg}`);

    this.client = new GatewayClient(this.currentConfig, log);
    this.discovery = new OllamaDiscovery({ client: this.client, log });
    this.catalog = new ModelCatalog({
      client: this.client,
      discovery: this.discovery,
      getConfig: () => this.currentConfig,
      log,
      onStatusChanged: () => this.deps.onStatusChanged(),
    });
    this.chatHandler = new ChatRequestHandler({
      client: this.client,
      catalog: this.catalog,
      getConfig: () => this.currentConfig,
      log,
      onCompleted: (modelId, modelName, usage) =>
        this.deps.onCompleted(modelId, modelName, usage, this.profile),
      showOutput: () => this.deps.showOutput(),
    });
    this.inlineCompletions = new InlineCompletionService({
      client: this.client,
      getConfig: () => this.currentConfig,
      getDefaultModelId: () => this.catalog.getCachedModels()[0]?.id,
      log,
    });
  }

  public getConfig(): GatewayConfig {
    return this.currentConfig;
  }

  public update(profile: Profile, nextConfig: GatewayConfig): void {
    this.profile = profile;
    if (isDeepStrictEqual(this.currentConfig, nextConfig)) {
      return;
    }
    this.currentConfig = nextConfig;
    this.client.updateConfig(this.currentConfig);
    this.inlineCompletions.resetSuffixProbe();
    this.catalog.reset();
    this.discovery.reset();
  }

  public invalidateCache(): void {
    this.catalog.invalidateCache();
    this.discovery.reset();
  }
}
