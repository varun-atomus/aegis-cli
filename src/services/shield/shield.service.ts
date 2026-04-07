import axios, { AxiosInstance } from "axios";
import { ContainerClient } from "@azure/storage-blob";
import { execSync } from "child_process";
import { existsSync, mkdirSync, chmodSync } from "fs";
import path from "path";
import { webcrypto } from "crypto";
import { Service } from "../base/service";
import { ConfigService } from "../config/config.service";
import {
  IShieldOperationResult,
  IOperationResult,
  ShieldContext,
  ExecReply,
} from "../../types";
import {
  ShieldConfig,
  ShieldInstallConfig,
  Directories,
  EnvVars,
} from "../../types/constants";
import { getDeviceInfo } from "../../utils/device-info";
import {
  isServiceActive,
  startService,
  getServiceStatus,
} from "../../utils/systemd";

const SHIELD_SERVICE_NAME = "atomus-shield";

// Azure SDK may require Web Crypto in packaged/headless runtimes where
// globalThis.crypto is missing.
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}

/**
 * Service for communicating with the Atomus Shield daemon.
 * Shield is a Go-based daemon running on localhost:7238 that handles
 * privileged operations (sudo commands, osquery, etc.).
 *
 * Supports auto-downloading and installing Shield from Azure Blob Storage
 * (mirroring the Mac app's pattern).
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
    // Check if shield daemon is already running
    const isRunning = await this.pingAgent(false);
    if (isRunning) {
      this.logger.info("Shield daemon is reachable");
      return;
    }

    // Check if auto-install is disabled
    if (process.env[EnvVars.SKIP_SHIELD_INSTALL] === "true") {
      this.logger.warn(
        "Shield daemon is not reachable and AEGIS_SKIP_SHIELD_INSTALL=true. Skipping auto-install."
      );
      return;
    }

    // Attempt auto-download and install
    this.logger.info("Shield daemon not reachable. Attempting auto-install...");
    const installResult = await this.downloadAndInstallShield();
    if (!installResult.success) {
      this.logger.warn(
        `Shield auto-install failed: ${installResult.error}. Some features may be unavailable.`
      );
      return;
    }

    // Wait for Shield to come up after install
    const alive = await this.waitForShieldStart();
    if (alive) {
      this.logger.info("Shield daemon started successfully after install");
    } else {
      this.logger.warn(
        "Shield installed but daemon not reachable after waiting. Check service logs."
      );
    }
  }

  // ─── Auto-Install from Azure Blob ──────────────────────────────────

  /**
   * Download and install Shield binary from Azure Blob Storage.
   * Mirrors the Mac app's AtomusShieldService.installAtomusShield() pattern.
   */
  private async downloadAndInstallShield(
    connectionStringOverride?: string
  ): Promise<IOperationResult> {
    try {
      // Step 1: Get Azure storage connection string
      const connString =
        connectionStringOverride || (await this.getStorageConnectionString());
      if (!connString) {
        return {
          success: false,
          error:
            "Could not obtain Azure storage connection string. Ensure you are authenticated and config has been pulled, or pass --connection-string manually.",
        };
      }

      // Step 2: Determine platform-specific container and download
      const platform = process.platform;
      const containerName =
        platform === "darwin"
          ? ShieldInstallConfig.CONTAINER.darwin
          : ShieldInstallConfig.CONTAINER.linux;

      this.logger.info(
        `Downloading Shield binary from container: ${containerName}`
      );
      const dlResult = await this.downloadShieldBinary(
        connString,
        containerName
      );
      if (!dlResult.success) {
        return dlResult;
      }

      // Step 3: Check if Shield is running (for silent update)
      if (await this.pingAgent(false)) {
        this.logger.info(
          "Shield is running. Attempting silent update..."
        );
        const updateResult = await this.silentUpdateShield(
          dlResult.binaryPath
        );
        if (updateResult.success) {
          return updateResult;
        }
        this.logger.warn(
          `Silent update failed: ${updateResult.error}. Falling back to interactive install.`
        );
      }

      // Step 4: Platform-specific install
      if (platform === "darwin") {
        return this.installShieldDarwin(connString, containerName);
      } else {
        return this.installShieldLinux(connString, containerName);
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Shield install error: ${err.message}`,
      };
    }
  }

  /**
   * Get the Azure storage connection string from the API
   * (matching Mac app's AegisGlobalConfig.getStorageConnectionString).
   */
  private async getStorageConnectionString(): Promise<string | null> {
    try {
      const clientResult =
        await this.configService.getAuthenticatedApiClient();
      if (!clientResult.success) {
        this.logger.warn(
          `Cannot get API client for storage connection string: ${clientResult.error}`
        );
        return null;
      }

      const result = await clientResult.data.getGlobalConfig(
        ShieldInstallConfig.STORAGE_CONNECTION_STRING_KEY
      );
      if (result.success && typeof result.data === "string") {
        return result.data;
      }
      const errMsg = !result.success ? result.error : "invalid response";
      this.logger.warn(
        `Failed to get storage connection string: ${errMsg}`
      );
      return null;
    } catch (err: any) {
      this.logger.warn(
        `Error getting storage connection string: ${err.message}`
      );
      return null;
    }
  }

  /**
   * Download the Shield binary from Azure Blob Storage.
   */
  private async downloadShieldBinary(
    connectionString: string,
    containerName: string
  ): Promise<IOperationResult & { binaryPath: string }> {
    try {
      // Ensure temp dir exists
      const tmpDir = ShieldInstallConfig.TMP_DIR;
      if (!existsSync(tmpDir)) {
        mkdirSync(tmpDir, { recursive: true });
      }

      const binaryPath = path.join(
        tmpDir,
        ShieldInstallConfig.BINARY_NAME
      );
      const client = new ContainerClient(connectionString, containerName);
      const blobClient = client.getBlobClient(
        ShieldInstallConfig.BINARY_NAME
      );
      await blobClient.downloadToFile(binaryPath);

      // Make executable
      chmodSync(binaryPath, 0o755);

      this.logger.info(`Shield binary downloaded to: ${binaryPath}`);
      return { success: true, binaryPath };
    } catch (err: any) {
      return {
        success: false,
        error: `Download failed: ${err.message}`,
        binaryPath: "",
      };
    }
  }

  /**
   * Try silent update via Shield's own /updater/install endpoint.
   * Matching Mac app's updateAtomusShieldSilent().
   */
  private async silentUpdateShield(
    binaryPath: string
  ): Promise<IOperationResult> {
    try {
      const infoResult = await this.get<{ pid: number; version: string }>(
        ShieldConfig.ROUTES.UPDATER_INFO
      );
      if (!infoResult.success) {
        return {
          success: false,
          error: `Cannot get running Shield info: ${infoResult.error}`,
        };
      }

      const originalPid = infoResult.data.pid;

      // Send update request
      const updateResult = await this.post(
        ShieldConfig.ROUTES.INSTALL_UPDATE,
        { binPath: binaryPath }
      );
      // ECONNRESET is expected — Shield restarts before responding
      if (
        !updateResult.success &&
        !updateResult.error?.includes("ECONNRESET")
      ) {
        return {
          success: false,
          error: `Update request failed: ${updateResult.error}`,
        };
      }

      // Wait for restart
      await this.sleep(2000);
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await this.pingAgent(false)) {
          const newInfo = await this.get<{
            pid: number;
            version: string;
          }>(ShieldConfig.ROUTES.UPDATER_INFO);
          if (
            newInfo.success &&
            newInfo.data.pid !== originalPid
          ) {
            this.logger.info(
              `Shield silently updated: v${newInfo.data.version} (PID ${newInfo.data.pid})`
            );
            return { success: true };
          }
        }
        await this.sleep(2000);
      }

      return {
        success: false,
        error: "Timed out waiting for Shield restart after silent update",
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Silent update error: ${err.message}`,
      };
    }
  }

  /**
   * Install Shield on macOS.
   * Mirrors Mac app's DarwinAtomusShieldService.installAtomusShieldInteractive().
   */
  private async installShieldDarwin(
    connectionString: string,
    containerName: string
  ): Promise<IOperationResult> {
    try {
      const cfg = ShieldInstallConfig.DARWIN;
      const tmpDir = ShieldInstallConfig.TMP_DIR;
      const binaryPath = path.join(
        tmpDir,
        ShieldInstallConfig.BINARY_NAME
      );

      // Download plist file
      const client = new ContainerClient(connectionString, containerName);
      const plistPath = path.join(tmpDir, cfg.PLIST_FILE);
      await client
        .getBlobClient(cfg.PLIST_FILE)
        .downloadToFile(plistPath);

      // Run elevated install steps via sudo
      const commands = [
        `mkdir -p '${cfg.AGENT_DIR}'`,
        `cp '${binaryPath}' '${cfg.AGENT_DIR}/${ShieldInstallConfig.BINARY_NAME}'`,
        `cp '${plistPath}' '${cfg.LAUNCH_DAEMON_DIR}/${cfg.PLIST_FILE}'`,
        `chown root:wheel '${cfg.LAUNCH_DAEMON_DIR}/${cfg.PLIST_FILE}'`,
        `chmod +x '${cfg.AGENT_DIR}/${ShieldInstallConfig.BINARY_NAME}'`,
        `launchctl unload '${cfg.LAUNCH_DAEMON_DIR}/${cfg.PLIST_FILE}' 2>/dev/null || true`,
        `launchctl load '${cfg.LAUNCH_DAEMON_DIR}/${cfg.PLIST_FILE}'`,
      ];

      this.logger.info(
        "Installing Shield on macOS (requires sudo)..."
      );
      execSync(`sudo sh -c '${commands.join(" && ")}'`, {
        stdio: "inherit",
      });

      // Wait for launchctl to start the service
      await this.sleep(5000);

      this.logger.info("Shield installed on macOS via launchctl");
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: `macOS install failed: ${err.message}`,
      };
    }
  }

  /**
   * Install Shield on Linux.
   * Mirrors Mac app's LinuxAtomusShieldService.installAtomusShieldInteractive().
   */
  private async installShieldLinux(
    connectionString: string,
    containerName: string
  ): Promise<IOperationResult> {
    try {
      const cfg = ShieldInstallConfig.LINUX;
      const tmpDir = ShieldInstallConfig.TMP_DIR;
      const binaryPath = path.join(
        tmpDir,
        ShieldInstallConfig.BINARY_NAME
      );

      // Download systemd service file
      const client = new ContainerClient(connectionString, containerName);
      const servicePath = path.join(tmpDir, cfg.SERVICE_FILE);
      await client
        .getBlobClient(cfg.SERVICE_FILE)
        .downloadToFile(servicePath);

      // Run elevated install steps via sudo
      const commands = [
        `mkdir -p '${cfg.AGENT_DIR}'`,
        `cp '${binaryPath}' '${cfg.AGENT_DIR}/'`,
        `cp '${servicePath}' '${cfg.SERVICE_DIR}/'`,
        `chmod +x '${cfg.AGENT_DIR}/${ShieldInstallConfig.BINARY_NAME}'`,
        `systemctl daemon-reload`,
        `systemctl enable '${SHIELD_SERVICE_NAME}'`,
        `systemctl restart '${SHIELD_SERVICE_NAME}'`,
      ];

      this.logger.info(
        "Installing Shield on Linux (requires sudo)..."
      );
      execSync(`sudo sh -c '${commands.join(" && ")}'`, {
        stdio: "inherit",
      });

      // Wait for systemd to start the service
      await this.sleep(5000);

      this.logger.info("Shield installed on Linux via systemd");
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: `Linux install failed: ${err.message}`,
      };
    }
  }

  /**
   * Wait for Shield to become reachable after install.
   */
  private async waitForShieldStart(): Promise<boolean> {
    for (let i = 0; i < 15; i++) {
      if (await this.pingAgent(false)) {
        return true;
      }
      await this.sleep(2000);
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
