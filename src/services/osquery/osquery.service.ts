import { ContainerClient } from "@azure/storage-blob";
import { execSync, spawn as spawnProcess } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  openSync,
} from "fs";
import path from "path";
import { webcrypto } from "crypto";
import { Service } from "../base/service";
import { ConfigService } from "../config/config.service";
import { IOperationResult } from "../../types";
import {
  OsqueryInstallConfig,
  ShieldInstallConfig,
  EnvVars,
} from "../../types/constants";
import { createServiceLogger } from "../../utils/logger";

if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}

type OsqueryServiceId = "osquery";

/**
 * Service for installing and managing osquery.
 * Downloads configs/packs from Azure Blob Storage and launches osqueryd
 * in standalone mode for container/non-systemd environments.
 */
export class OsqueryService extends Service {
  private configService: ConfigService;

  constructor(configService: ConfigService) {
    super("healthcheck" as any);
    this.configService = configService;
    this.logger = createServiceLogger("osquery");
  }

  protected async doInit(): Promise<void> {
    if (this.isOsquerydRunning()) {
      this.logger.info("osqueryd is already running");
      return;
    }

    if (process.env[EnvVars.SKIP_SHIELD_INSTALL] === "true") {
      this.logger.warn("AEGIS_SKIP_SHIELD_INSTALL=true; skipping osquery setup");
      return;
    }

    this.logger.info("Setting up osquery...");
    const result = await this.setupOsquery();
    if (!result.success) {
      this.logger.warn(`Osquery setup failed: ${result.error}`);
    }
  }

  // ─── Public API ────────────────────────────────────────────────────

  async setupOsquery(): Promise<IOperationResult> {
    try {
      // 1) Install osqueryd binary if not present
      if (!this.isOsqueryInstalled()) {
        const installResult = await this.installOsqueryBinary();
        if (!installResult.success) {
          return installResult;
        }
      } else {
        this.logger.info("osqueryd binary already installed");
      }

      // 2) Download configs and packs from blob
      const configResult = await this.downloadOsqueryConfigs();
      if (!configResult.success) {
        this.logger.warn(`Config download failed: ${configResult.error}; continuing with existing configs`);
      }

      // 3) Launch osqueryd if not running
      if (!this.isOsquerydRunning()) {
        this.launchOsqueryd();
        await this.sleep(3000);

        if (this.isOsquerydRunning()) {
          this.logger.info("osqueryd launched successfully");
        } else {
          const logSnippet = this.getOsqueryLogSnippet();
          this.logger.warn(
            `osqueryd may have exited early${logSnippet ? `: ${logSnippet}` : ""}`
          );
        }
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: `Osquery setup error: ${err.message}` };
    }
  }

  isOsqueryInstalled(): boolean {
    return (
      this.hasCommand("osqueryd") ||
      existsSync("/usr/bin/osqueryd") ||
      existsSync("/usr/local/bin/osqueryd") ||
      existsSync(`${OsqueryInstallConfig.INSTALL_DIR}/osqueryd`)
    );
  }

  isOsquerydRunning(): boolean {
    try {
      execSync("pgrep -f osqueryd", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Binary Install ────────────────────────────────────────────────

  private async installOsqueryBinary(): Promise<IOperationResult> {
    this.logger.info("Installing osquery binary...");

    if (this.hasCommand("apt-get")) {
      return this.installViaApt();
    }

    if (this.hasCommand("yum") || this.hasCommand("dnf")) {
      return this.installViaRpm();
    }

    return this.installFromOfficialRelease();
  }

  private installViaApt(): IOperationResult {
    try {
      this.logger.info("Installing osquery via apt...");
      const commands = [
        'apt-get update -qq',
        'apt-get install -y -qq software-properties-common gnupg curl',
        'DEBIAN_FRONTEND=noninteractive apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 1484120AC4E9F8A1A577AEEE97A80C63C9D8B80B 2>/dev/null || true',
        'add-apt-repository -y "deb [arch=amd64] https://pkg.osquery.io/deb deb main" 2>/dev/null || true',
        'apt-get update -qq',
        'apt-get install -y -qq osquery || true',
      ];

      for (const cmd of commands) {
        try {
          execSync(cmd, { stdio: "pipe", timeout: 120000 });
        } catch {
          this.logger.debug(`apt command soft-failed: ${cmd}`);
        }
      }

      if (this.isOsqueryInstalled()) {
        this.logger.info("osquery installed via apt");
        return { success: true };
      }

      return this.installFromOfficialRelease();
    } catch (err: any) {
      this.logger.warn(`apt install failed: ${err.message}`);
      return this.installFromOfficialRelease();
    }
  }

  private installViaRpm(): IOperationResult {
    try {
      this.logger.info("Installing osquery via rpm...");
      const rpmUrl =
        process.arch === "arm64"
          ? "https://pkg.osquery.io/rpm/osquery-latest.aarch64.rpm"
          : "https://pkg.osquery.io/rpm/osquery-latest.x86_64.rpm";

      execSync(
        `curl -sSL "${rpmUrl}" -o /tmp/osquery.rpm && rpm -ivh /tmp/osquery.rpm && rm -f /tmp/osquery.rpm`,
        { stdio: "pipe", timeout: 120000 }
      );

      if (this.isOsqueryInstalled()) {
        this.logger.info("osquery installed via rpm");
        return { success: true };
      }
      return { success: false, error: "rpm install completed but osqueryd not found" };
    } catch (err: any) {
      return { success: false, error: `rpm install failed: ${err.message}` };
    }
  }

  private installFromOfficialRelease(): IOperationResult {
    try {
      this.logger.info("Installing osquery from official deb package...");
      const debUrl =
        process.arch === "arm64"
          ? "https://pkg.osquery.io/deb/osquery_5.12.1-1.linux_arm64.deb"
          : "https://pkg.osquery.io/deb/osquery_5.12.1-1.linux_amd64.deb";

      execSync(
        `curl -sSL "${debUrl}" -o /tmp/osquery.deb && dpkg -i /tmp/osquery.deb 2>/dev/null; apt-get install -f -y -qq 2>/dev/null; rm -f /tmp/osquery.deb`,
        { stdio: "pipe", timeout: 120000 }
      );

      if (this.isOsqueryInstalled()) {
        this.logger.info("osquery installed from official release");
        return { success: true };
      }
      return { success: false, error: "deb install completed but osqueryd not found" };
    } catch (err: any) {
      return { success: false, error: `Official release install failed: ${err.message}` };
    }
  }

  // ─── Config/Pack Download from Blob ────────────────────────────────

  async downloadOsqueryConfigs(): Promise<IOperationResult> {
    const connString = await this.getStorageConnectionString();
    if (!connString) {
      return {
        success: false,
        error: "No Azure storage connection string available for osquery config download",
      };
    }

    const cfg = OsqueryInstallConfig;

    // Ensure local directories exist
    for (const dir of [cfg.CONFIG_DIR, cfg.PACKS_DIR, cfg.DB_DIR, cfg.LOG_DIR]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    let downloadedAny = false;

    // Download configs (osquery.conf etc.)
    try {
      await this.downloadBlobContainerContents(
        connString,
        cfg.CONTAINERS.configs,
        cfg.CONFIG_DIR
      );
      this.logger.info("Downloaded osquery configs");
      downloadedAny = true;
    } catch (err: any) {
      this.logger.warn(`Failed to download osquery configs: ${err.message}`);
    }

    // Download platform-specific packs
    try {
      await this.downloadBlobContainerContents(
        connString,
        cfg.CONTAINERS.packs,
        cfg.PACKS_DIR
      );
      this.logger.info("Downloaded platform-specific osquery packs");
      downloadedAny = true;
    } catch (err: any) {
      this.logger.warn(`Failed to download platform packs: ${err.message}`);
    }

    // Download cross-platform packs
    try {
      await this.downloadBlobContainerContents(
        connString,
        cfg.CONTAINERS.crossPlatformPacks,
        cfg.PACKS_DIR
      );
      this.logger.info("Downloaded cross-platform osquery packs");
      downloadedAny = true;
    } catch (err: any) {
      this.logger.warn(`Failed to download cross-platform packs: ${err.message}`);
    }

    return downloadedAny
      ? { success: true }
      : { success: false, error: "No osquery configs or packs could be downloaded" };
  }

  private async downloadBlobContainerContents(
    connectionString: string,
    containerName: string,
    targetDir: string
  ): Promise<void> {
    const client = new ContainerClient(connectionString, containerName);
    const blobs = client.listBlobsFlat();

    for await (const blob of blobs) {
      const blobClient = client.getBlobClient(blob.name);
      const targetPath = path.join(targetDir, blob.name);

      const targetSubDir = path.dirname(targetPath);
      if (!existsSync(targetSubDir)) {
        mkdirSync(targetSubDir, { recursive: true });
      }

      await blobClient.downloadToFile(targetPath);
      this.logger.debug(`Downloaded: ${containerName}/${blob.name} → ${targetPath}`);
    }
  }

  // ─── Launch osqueryd ───────────────────────────────────────────────

  private launchOsqueryd(): void {
    const cfg = OsqueryInstallConfig;
    const osquerydPath = this.findOsquerydPath();
    if (!osquerydPath) {
      this.logger.error("osqueryd binary not found; cannot launch");
      return;
    }

    const configPath = path.join(cfg.CONFIG_DIR, cfg.CONFIG_FILE);
    const hasConfig = existsSync(configPath);

    const args = [
      "--daemonize=false",
      `--database_path=${cfg.DB_DIR}`,
      `--logger_path=${cfg.LOG_DIR}`,
      `--pidfile=${cfg.PID_FILE}`,
    ];

    if (hasConfig) {
      args.push(`--config_path=${configPath}`);
    } else {
      args.push("--config_plugin=filesystem");
      args.push("--config_path=/dev/null");
      this.logger.warn("No osquery.conf found; launching with minimal config");
    }

    // Add packs path if packs exist
    if (existsSync(cfg.PACKS_DIR) && readdirSync(cfg.PACKS_DIR).length > 0) {
      args.push(`--pack_delimiter=_`);
    }

    const logPath = path.join(cfg.LOG_DIR, "osqueryd-stdout.log");
    if (!existsSync(cfg.LOG_DIR)) {
      mkdirSync(cfg.LOG_DIR, { recursive: true });
    }
    const logFd = openSync(logPath, "w");

    const child = spawnProcess(osquerydPath, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env },
    });

    child.unref();
    this.logger.info(`osqueryd launched in background (PID: ${child.pid})`);
  }

  private findOsquerydPath(): string | null {
    const candidates = [
      "/usr/bin/osqueryd",
      "/usr/local/bin/osqueryd",
      `${OsqueryInstallConfig.INSTALL_DIR}/osqueryd`,
    ];

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }

    try {
      const result = execSync("which osqueryd", { encoding: "utf-8" }).trim();
      if (result) return result;
    } catch {}

    return null;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private async getStorageConnectionString(): Promise<string | null> {
    try {
      const clientResult = await this.configService.getAuthenticatedApiClient();
      if (!clientResult.success) return null;

      const result = await clientResult.data.getGlobalConfig(
        ShieldInstallConfig.STORAGE_CONNECTION_STRING_KEY
      );
      if (result.success && typeof result.data === "string") {
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  private hasCommand(cmd: string): boolean {
    try {
      execSync(`command -v ${cmd}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getOsqueryLogSnippet(): string | null {
    const logPath = path.join(OsqueryInstallConfig.LOG_DIR, "osqueryd-stdout.log");
    try {
      if (!existsSync(logPath)) return null;
      const content = readFileSync(logPath, "utf-8").trim();
      if (!content) return null;
      const lines = content.split("\n");
      return lines.slice(-5).join(" | ");
    } catch {
      return null;
    }
  }
}
