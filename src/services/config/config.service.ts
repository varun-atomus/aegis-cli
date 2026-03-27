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
  DevDefaults,
} from "../../types/constants";
import { KVStore, ExternalApiClient } from "../../utils";
import { getConfigCachePath } from "../../utils/directories";

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
    this.configCache = new KVStore(getConfigCachePath());
    this.userConfig = new KVStore(Files.USER_CONFIG);
    // Use dev defaults for initial API client (before config pull)
    this.externalApi = new ExternalApiClient(
      DevDefaults.EXTERNAL_API_URL,
      DevDefaults.EXTERNAL_API_BACKUP_URL
    );
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

    // Support both legacy and current backend schemas.
    // Examples:
    // - { workspaceId, workspaceKey }
    // - { WorkspaceInfo: { customerId }, WorkspaceKey }
    const workspaceId =
      laInfo.workspaceId ||
      laInfo.WorkspaceId ||
      laInfo.workspaceID ||
      laInfo.WorkspaceInfo?.customerId ||
      laInfo.WorkspaceInfo?.workspaceId ||
      laInfo.WorkspaceInfo?.WorkspaceId;

    const workspaceKey = laInfo.workspaceKey || laInfo.WorkspaceKey;

    if (
      typeof workspaceId !== "string" ||
      workspaceId.trim().length === 0 ||
      typeof workspaceKey !== "string" ||
      workspaceKey.trim().length === 0
    ) {
      this.logger.warn(
        "Log Analytics config is present but missing workspace credentials"
      );
      return null;
    }

    const creds = this.authService.getStoredCredentials();
    const cloudInstance = creds?.cloudInstance || "commercial";

    return {
      workspaceId,
      workspaceKey,
      baseUrl:
        cloudInstance === "gov"
          ? `ods.opinsights.azure.us`
          : `ods.opinsights.azure.com`,
    };
  }

  /**
   * Get the external API URL (from stored config or dev default).
   */
  getExternalApiUrl(): string {
    return (
      this.userConfig.get<string>("externalApiUrl") ||
      DevDefaults.EXTERNAL_API_URL
    );
  }

  /**
   * Get the backup external API URL (from stored config or dev default).
   */
  getExternalApiBackupUrl(): string {
    return (
      this.userConfig.get<string>("externalApiBackupUrl") ||
      DevDefaults.EXTERNAL_API_BACKUP_URL
    );
  }

  /**
   * Get the upload logs API key (from stored config or dev default).
   */
  getUploadLogsApiKey(): string {
    return (
      this.userConfig.get<string>("uploadLogsApiKey") ||
      DevDefaults.UPLOAD_LOGS_API_KEY
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
      this.getExternalApiBackupUrl()
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
