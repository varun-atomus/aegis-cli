import * as fs from "fs";
import { Service } from "../base/service";
import { AuthService } from "../auth/auth.service";
import {
  AegisConfig,
  LAWorkspaceInfo,
  CloudInstance,
  ITypedOperationResult,
} from "../../types";
import {
  Files,
  AegisConfigKeys,
  AppConfigKeys,
  ExternalApiConfig,
} from "../../types/constants";
import { KVStore, ExternalApiClient } from "../../utils";

/**
 * Configuration service.
 * Downloads and caches Aegis configuration from Azure App Config (via external API).
 * Manages tenant-specific config, global app config, and the config cache.
 */
export class ConfigService extends Service {
  private authService: AuthService;
  private externalApi: ExternalApiClient;
  private configCache: KVStore;
  private userConfig: KVStore;
  private aegisConfig: AegisConfig | null = null;

  constructor(authService: AuthService) {
    super("aegis-config");
    this.authService = authService;
    this.configCache = new KVStore(Files.CONFIG_CACHE);
    this.userConfig = new KVStore(Files.USER_CONFIG);
    this.externalApi = new ExternalApiClient();
  }

  protected async doInit(): Promise<void> {
    // Load cached config if available
    const cached = this.configCache.get<AegisConfig>("aegisConfig");
    if (cached) {
      this.aegisConfig = cached;
      this.logger.debug("Loaded cached aegis config");
    }
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Pull fresh configuration from the Atomus API.
   * Requires authentication.
   */
  async pullConfig(): Promise<ITypedOperationResult<AegisConfig>> {
    await this.waitForInit();

    const tokenResult = await this.authService.acquireTokenSilent();
    if (!tokenResult.success) {
      return { success: false, error: tokenResult.error };
    }

    const { accessToken, tenantId, cloudInstance } = tokenResult.data;
    this.externalApi.setToken(accessToken);

    // First get the external API URL from global config
    const apiUrlResult = await this.externalApi.getGlobalConfig(
      AppConfigKeys.EXTERNAL_API_URL
    );

    if (apiUrlResult.success && apiUrlResult.data) {
      // Reconfigure client with the correct base URL
      const backupUrlResult = await this.externalApi.getGlobalConfig(
        AppConfigKeys.EXTERNAL_API_BACKUP_URL
      );
      this.externalApi = new ExternalApiClient(
        apiUrlResult.data,
        backupUrlResult.success ? backupUrlResult.data : undefined
      );
      this.externalApi.setToken(accessToken);

      // Store API URLs
      this.userConfig.set("externalApiUrl", apiUrlResult.data);
      if (backupUrlResult.success) {
        this.userConfig.set("externalApiBackupUrl", backupUrlResult.data);
      }
    }

    // Pull tenant-specific config
    const configResult = await this.externalApi.getAegisConfig(
      tenantId,
      cloudInstance
    );

    if (!configResult.success) {
      this.logger.error(`Failed to pull config: ${configResult.error}`);
      return { success: false, error: configResult.error };
    }

    this.aegisConfig = configResult.data;

    // Cache the config
    this.configCache.set("aegisConfig", configResult.data);
    this.configCache.set("lastPull", new Date().toISOString());
    this.userConfig.set("tenantId", tenantId);
    this.userConfig.set("cloudInstance", cloudInstance);

    this.logger.info("Configuration pulled and cached successfully");

    return { success: true, data: configResult.data };
  }

  /**
   * Get the cached Aegis configuration.
   */
  getConfig(): AegisConfig | null {
    return this.aegisConfig;
  }

  /**
   * Get Log Analytics workspace info from the config.
   */
  getLogAnalyticsInfo(): LAWorkspaceInfo | null {
    if (!this.aegisConfig) return null;

    const laInfo = this.aegisConfig[AegisConfigKeys.LOG_ANALYTICS];
    if (!laInfo) return null;

    const creds = this.authService.getStoredCredentials();
    const cloudInstance = creds?.cloudInstance || "commercial";

    return {
      workspaceId: laInfo.workspaceId,
      workspaceKey: laInfo.workspaceKey,
      baseUrl:
        cloudInstance === "gov"
          ? `ods.opinsights.azure.us`
          : `ods.opinsights.azure.com`,
    };
  }

  /**
   * Get the external API URL (from config or fallback).
   */
  getExternalApiUrl(): string {
    return (
      this.userConfig.get<string>("externalApiUrl") ||
      ExternalApiConfig.DEV_BASE_URL
    );
  }

  /**
   * Get the ExternalApiClient instance with proper auth.
   */
  async getAuthenticatedApiClient(): Promise<
    ITypedOperationResult<ExternalApiClient>
  > {
    const tokenResult = await this.authService.acquireTokenSilent();
    if (!tokenResult.success) {
      return { success: false, error: tokenResult.error };
    }

    const client = new ExternalApiClient(
      this.getExternalApiUrl(),
      this.userConfig.get<string>("externalApiBackupUrl") || undefined
    );
    client.setToken(tokenResult.data.accessToken);
    return { success: true, data: client };
  }

  /**
   * Get a specific config value.
   */
  getConfigValue<T = any>(key: string): T | undefined {
    return this.aegisConfig?.[key] as T | undefined;
  }

  /**
   * Get the cloud instance from stored config.
   */
  getCloudInstance(): CloudInstance {
    return this.userConfig.get<CloudInstance>("cloudInstance") || "commercial";
  }

  /**
   * Get the last config pull timestamp.
   */
  getLastPullTime(): string | null {
    return this.configCache.get<string>("lastPull") || null;
  }
}
