import { ServiceState, ServiceId, LogLevel } from "../../types";
import { createServiceLogger } from "../../utils/logger";
import { getDeviceInfo } from "../../utils/device-info";
import type { ExternalApiClient } from "../../utils/external-api";

/**
 * Factory function that returns an authenticated ExternalApiClient.
 * Injected at startup by the daemon or CLI entry point.
 */
type ApiClientFactory = () => Promise<ExternalApiClient | null>;

function getExecutionMode(): "cli" | "daemon" {
  const argv = process.argv.join(" ").toLowerCase();
  return argv.includes("daemon") ? "daemon" : "cli";
}

/**
 * Abstract base class for all Aegis CLI services.
 * Ported from the Electron app's Service base class pattern.
 *
 * Provides:
 * - State management (initializing → ready/error)
 * - Async initialization with waitForInit()
 * - Scoped logging per service
 * - Automatic service log alerts on critical errors
 */
export abstract class Service {
  public readonly serviceId: ServiceId;
  protected state: ServiceState = "unknown";
  protected logger: ReturnType<typeof createServiceLogger>;

  private initPromise: Promise<void>;
  private initResolve!: () => void;
  private initReject!: (err: Error) => void;

  /**
   * Shared factory for sending service log alerts.
   * Injected once at app startup via Service.setApiClientFactory().
   */
  private static apiClientFactory: ApiClientFactory | null = null;

  constructor(serviceId: ServiceId, isDaemon = false) {
    this.serviceId = serviceId;
    this.logger = createServiceLogger(serviceId, isDaemon);

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });
  }

  /**
   * Inject the API client factory so all services can send alerts.
   * Call once at app startup after AuthService is initialized.
   */
  static setApiClientFactory(factory: ApiClientFactory): void {
    Service.apiClientFactory = factory;
  }

  /**
   * Start initialization. Call this from the constructor or externally.
   */
  async init(): Promise<void> {
    try {
      this.setState("initializing");
      await this.doInit();
      this.setState("ready");
      this.initResolve();
    } catch (err: any) {
      this.setState("error");
      this.logger.error(`Initialization failed: ${err.message}`);
      this.initResolve(); // Resolve anyway so waiters don't hang
    }
  }

  /**
   * Subclasses implement their initialization logic here.
   */
  protected abstract doInit(): Promise<void>;

  /**
   * Wait for initialization to complete.
   * Should be called at the start of any public async method.
   */
  async waitForInit(): Promise<void> {
    return this.initPromise;
  }

  /**
   * Get the current service state.
   */
  getState(): ServiceState {
    return this.state;
  }

  /**
   * Is the service ready for use?
   */
  isReady(): boolean {
    return this.state === "ready";
  }

  /**
   * Update the service state.
   */
  protected setState(state: ServiceState, message?: string): void {
    const prev = this.state;
    this.state = state;
    if (message) {
      this.logger.info(`[${prev} → ${state}] ${message}`);
    } else {
      this.logger.debug(`State: ${prev} → ${state}`);
    }
  }

  /**
   * Log helper matching the Electron app pattern.
   * Critical logs automatically send a service log alert to the backend.
   */
  protected log(level: LogLevel, message: string): void {
    switch (level) {
      case "critical":
        this.logger.critical(message);
        // Fire-and-forget alert to backend (matching Mac app pattern)
        this.sendServiceAlert(message).catch(() => {});
        break;
      case "error":
        this.logger.error(message);
        break;
      case "warning":
        this.logger.warn(message);
        break;
      case "info":
        this.logger.info(message);
        break;
      case "debug":
        this.logger.debug(message);
        break;
    }
  }

  /**
   * Send a service log alert to the backend for critical errors.
   */
  private async sendServiceAlert(message: string): Promise<void> {
    if (!Service.apiClientFactory) return;
    try {
      const api = await Service.apiClientFactory();
      if (!api) return;
      const deviceInfo = getDeviceInfo();
      await api.sendServiceLogAlert({
        level: "critical",
        message,
        service: this.serviceId,
        deviceName: deviceInfo.deviceName,
        timestamp: new Date().toISOString(),
        appSource: "aegis-cli",
        executionMode: getExecutionMode(),
      });
    } catch {
      // Never let alert failures affect the service
    }
  }
}
