import axios, { AxiosInstance, AxiosError } from "axios";
import {
  AegisResponse,
  AegisConfig,
  CloudInstance,
  IDeviceInfo,
} from "../types";
import { ExternalApiConfig, APP_VERSION } from "../types/constants";
import { createServiceLogger } from "./logger";

const log = createServiceLogger("external-api");

/**
 * Client for the Atomus External API.
 * Handles all communication with the Atomus backend.
 */
export class ExternalApiClient {
  private client: AxiosInstance;
  private backupClient: AxiosInstance | null = null;
  private baseUrl: string;

  constructor(baseUrl?: string, backupUrl?: string) {
    this.baseUrl = baseUrl || ExternalApiConfig.DEV_BASE_URL;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "aegis-version": `${APP_VERSION}-cli`,
        "aegis-app-source": "aegis-cli",
      },
    });

    if (backupUrl) {
      this.backupClient = axios.create({
        baseURL: backupUrl,
        timeout: 30000,
        headers: {
          "Content-Type": "application/json",
          "aegis-version": `${APP_VERSION}-cli`,
          "aegis-app-source": "aegis-cli",
        },
      });
    }
  }

  /**
   * Set the authorization token for authenticated requests.
   */
  setToken(token: string): void {
    this.client.defaults.headers.common["authorization"] = `Bearer ${token}`;
    if (this.backupClient) {
      this.backupClient.defaults.headers.common["authorization"] =
        `Bearer ${token}`;
    }
  }

  /**
   * Make a GET request with automatic fallback to backup URL.
   */
  private async get<T>(
    path: string,
    headers?: Record<string, string>
  ): Promise<AegisResponse<T>> {
    try {
      const response = await this.client.get(path, { headers });
      return response.data;
    } catch (err: any) {
      // Try backup URL on network errors
      if (this.backupClient && this.isNetworkError(err)) {
        log.warn(`Primary API failed, trying backup: ${err.message}`);
        try {
          const response = await this.backupClient.get(path, { headers });
          return response.data;
        } catch (backupErr: any) {
          return this.errorResponse(backupErr);
        }
      }
      return this.errorResponse(err);
    }
  }

  /**
   * Make a POST request with automatic fallback to backup URL.
   */
  private async post<T>(
    path: string,
    body: any,
    headers?: Record<string, string>
  ): Promise<AegisResponse<T>> {
    try {
      const response = await this.client.post(path, body, { headers });
      return response.data;
    } catch (err: any) {
      if (this.backupClient && this.isNetworkError(err)) {
        log.warn(`Primary API failed, trying backup: ${err.message}`);
        try {
          const response = await this.backupClient.post(path, body, {
            headers,
          });
          return response.data;
        } catch (backupErr: any) {
          return this.errorResponse(backupErr);
        }
      }
      return this.errorResponse(err);
    }
  }

  private isNetworkError(err: AxiosError): boolean {
    return (
      !err.response ||
      err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      err.code === "ETIMEDOUT"
    );
  }

  private errorResponse<T>(err: any): AegisResponse<T> {
    const message =
      err.response?.data?.error || err.message || "Unknown error";
    const code = err.response?.status || 500;
    return {
      success: false,
      code,
      error: message,
      data: undefined as any,
      isAegisResponse: true,
    };
  }

  // ─── API Methods ────────────────────────────────────────────────────

  /**
   * Get Aegis configuration for a tenant.
   */
  async getAegisConfig(
    tenantId: string,
    cloudInstance: CloudInstance
  ): Promise<AegisResponse<AegisConfig>> {
    return this.get(ExternalApiConfig.ROUTES.APP_CONFIG, {
      "cloud-instance": cloudInstance,
      "tenant-id": tenantId,
    });
  }

  /**
   * Get a global app config value.
   */
  async getGlobalConfig(key: string): Promise<AegisResponse<string>> {
    return this.get(
      `${ExternalApiConfig.ROUTES.GLOBAL_CONFIG}?key=${encodeURIComponent(key)}`
    );
  }

  /**
   * Send onboarding status for this device.
   */
  async sendOnboardingStatus(params: {
    email: string;
    os: string;
    onboardingStatus: string;
    deviceName: string;
    localUsername: string;
    osqueryMachineId?: string;
  }): Promise<AegisResponse<void>> {
    return this.post(ExternalApiConfig.ROUTES.ONBOARDING_STATUS, {
      ...params,
      appSource: "aegis-cli",
    });
  }

  /**
   * Post an update/telemetry log.
   */
  async postUpdateLog(
    eventName: string,
    deviceInfo: IDeviceInfo,
    details?: string
  ): Promise<AegisResponse<void>> {
    return this.post(ExternalApiConfig.ROUTES.UPDATE_LOGS, {
      appVersion: APP_VERSION,
      eventName,
      details: details || "",
      deviceName: deviceInfo.deviceName,
      platform: deviceInfo.platform,
      timestamp: new Date().toISOString(),
      username: deviceInfo.username,
      appSource: "aegis-cli",
    });
  }

  /**
   * Send a service log alert for critical issues.
   */
  async sendServiceLogAlert(params: {
    level: string;
    message: string;
    service: string;
    deviceName: string;
    timestamp: string;
    appSource?: string;
    executionMode?: "cli" | "daemon";
  }): Promise<AegisResponse<void>> {
    return this.post(ExternalApiConfig.ROUTES.SERVICE_LOG_ALERTS, {
      ...params,
      appSource: params.appSource || "aegis-cli",
      executionMode: params.executionMode || "cli",
    });
  }

  /**
   * Sync device integration IDs (matching Mac app's DeviceIntegrationsSyncJob).
   */
  async sendDeviceIntegrationIds(body: {
    appInfo: { aegisAppId: string; localUsername: string };
    hardwareInfo: { serialNumber: string };
    partitionInfo: { deviceName: string; platform: string; shieldId: string };
    deviceIntegrationInfo: Array<{ integrationId: string; value: string }>;
  }): Promise<AegisResponse<void>> {
    return this.post(
      ExternalApiConfig.ROUTES.DEVICE_INTEGRATION_IDS,
      body
    );
  }

  /**
   * Upload compressed logs.
   */
  async uploadLogs(
    deviceName: string,
    logsBase64: string,
    apiKey: string
  ): Promise<AegisResponse<void>> {
    return this.post(
      ExternalApiConfig.ROUTES.UPLOAD_LOGS,
      { deviceName, logsBase64 },
      { authorization: `Basic ${apiKey}` }
    );
  }

  /**
   * Get backup preferences for the current user.
   * Matching Mac app's getBackupPreferences().
   */
  async getBackupPreferences(): Promise<AegisResponse<any>> {
    return this.get(ExternalApiConfig.ROUTES.BACKUP_PREFERENCES);
  }

  /**
   * Get VPN preferences for the current user.
   * Matching Mac app's getVpnPreferences().
   */
  async getVpnPreferences(): Promise<AegisResponse<any>> {
    return this.get(ExternalApiConfig.ROUTES.VPN_PREFERENCES);
  }

  /**
   * Get Defender onboarding JSON for Linux devices.
   * Matching Mac app's getDefenderOnboardJson().
   */
  async getDefenderOnboardJson(): Promise<AegisResponse<string | null>> {
    return this.get(ExternalApiConfig.ROUTES.DEFENDER_ONBOARD_JSON);
  }

  /**
   * Check if Defender onboarding JSON exists.
   */
  async getDefenderOnboardJsonExists(): Promise<AegisResponse<boolean>> {
    return this.get(
      `${ExternalApiConfig.ROUTES.DEFENDER_ONBOARD_JSON}?is_for_exists=true`
    );
  }

  /**
   * Check if a feature is disabled for the current tenant.
   * Matching Mac app's getFeatureIsDisabled().
   */
  async getFeatureIsDisabled(
    featureId: string,
    tenantId: string,
    cloudInstance: CloudInstance
  ): Promise<AegisResponse<boolean>> {
    return this.get(
      `${ExternalApiConfig.ROUTES.DISABLED_FEATURES}?featureId=${encodeURIComponent(featureId)}`,
      {
        "cloud-instance": cloudInstance,
        "tenant-id": tenantId,
      }
    );
  }
}
