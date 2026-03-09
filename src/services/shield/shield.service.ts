import axios, { AxiosInstance } from "axios";
import { Service } from "../base/service";
import { ConfigService } from "../config/config.service";
import {
  IShieldOperationResult,
  IOperationResult,
  ShieldContext,
  ExecReply,
} from "../../types";
import { ShieldConfig, Directories } from "../../types/constants";
import { getDeviceInfo } from "../../utils/device-info";
import {
  isServiceActive,
  startService,
  getServiceStatus,
} from "../../utils/systemd";

const SHIELD_SERVICE_NAME = "atomus-shield";

/**
 * Service for communicating with the Atomus Shield daemon.
 * Shield is a Go-based daemon running on localhost:7238 that handles
 * privileged operations (sudo commands, osquery, etc.).
 */
export class ShieldService extends Service {
  private client: AxiosInstance;
  private configService: ConfigService;
  private initialized = false;

  constructor(configService: ConfigService) {
    super("atomus-shield");
    this.configService = configService;

    this.client = axios.create({
      baseURL: ShieldConfig.BASE_URL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": Buffer.from(process.pid.toString()).toString("base64"),
      },
    });
  }

  protected async doInit(): Promise<void> {
    // Check if shield daemon is running
    const isRunning = await this.pingAgent(false);
    if (isRunning) {
      this.logger.info("Shield daemon is reachable");
    } else {
      this.logger.warn(
        "Shield daemon is not reachable. Some features may be unavailable."
      );
    }
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Check if the shield daemon is reachable.
   */
  async pingAgent(waitForServiceInit = true): Promise<boolean> {
    if (waitForServiceInit) {
      await this.waitForInit();
    }
    try {
      const response = await this.client.get(ShieldConfig.ROUTES.PING, {
        timeout: 5000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Initialize the shield context with device info and log analytics config.
   * Should be called after authentication and config pull.
   */
  async initializeShield(): Promise<IOperationResult> {
    await this.waitForInit();

    const laInfo = this.configService.getLogAnalyticsInfo();
    if (!laInfo) {
      return {
        success: false,
        error: "No Log Analytics config available. Pull config first.",
      };
    }

    const creds = this.configService
      .getConfig()
      ? undefined
      : undefined;

    const context: ShieldContext = {
      email:
        (this.configService as any).authService?.getStoredCredentials()
          ?.email || undefined,
      externalApiUrl: this.configService.getExternalApiUrl(),
      deviceInfo: getDeviceInfo(),
      logDir: Directories.LOGS,
      laWorkspaceInfo: laInfo,
    };

    const result = await this.post<null>(ShieldConfig.ROUTES.INIT, context);

    if (result.success) {
      this.initialized = true;
      this.logger.info("Shield context initialized successfully");
    } else {
      this.logger.error(`Failed to initialize shield: ${result.error}`);
    }

    return result;
  }

  /**
   * Run a command through the shield daemon (elevated permissions).
   */
  async runCommand(
    command: string,
    expectedStatus = 0
  ): Promise<IShieldOperationResult<ExecReply>> {
    await this.waitForInit();

    return this.post<ExecReply>(ShieldConfig.ROUTES.RUN_COMMAND, {
      cmdStr: command,
      expectedStatus,
    });
  }

  /**
   * Get shield daemon info (PID, version).
   */
  async getInfo(): Promise<
    IShieldOperationResult<{ pid: number; version: string }>
  > {
    await this.waitForInit();
    return this.get<{ pid: number; version: string }>(
      ShieldConfig.ROUTES.UPDATER_INFO
    );
  }

  /**
   * Get the systemd service status of the shield daemon.
   */
  async getSystemdStatus() {
    return getServiceStatus(SHIELD_SERVICE_NAME);
  }

  /**
   * Start the shield systemd service.
   */
  async startShieldService(): Promise<IOperationResult> {
    return startService(SHIELD_SERVICE_NAME);
  }

  /**
   * Check if the shield systemd service is active.
   */
  async isShieldActive(): Promise<boolean> {
    return isServiceActive(SHIELD_SERVICE_NAME);
  }

  // ─── HTTP Methods ─────────────────────────────────────────────────

  private async get<T = null>(
    path: string
  ): Promise<IShieldOperationResult<T>> {
    try {
      const response = await this.client.get(path);
      return response.data;
    } catch (err: any) {
      return {
        success: false,
        error: err.response?.data?.error || err.message,
        errorCode: err.response?.status,
      };
    }
  }

  private async post<T = null>(
    path: string,
    body: object
  ): Promise<IShieldOperationResult<T>> {
    try {
      const response = await this.client.post(path, body);
      return response.data;
    } catch (err: any) {
      return {
        success: false,
        error: err.response?.data?.error || err.message,
        errorCode: err.response?.status,
      };
    }
  }
}
