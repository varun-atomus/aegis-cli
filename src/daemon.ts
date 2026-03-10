#!/usr/bin/env node

// Load .env before anything else
import "./utils/env";

/**
 * Aegis CLI Daemon
 *
 * Long-running background process that:
 * 1. Runs scheduled compliance healthchecks (daily at 2 PM)
 * 2. Maintains shield connectivity
 * 3. Auto-recovers on errors with exponential backoff
 *
 * Parallel to the Electron app's Main Process.
 */

import { ToadScheduler, SimpleIntervalJob, CronJob, AsyncTask } from "toad-scheduler";
import { AuthService } from "./services/auth/auth.service";
import { ConfigService } from "./services/config/config.service";
import { ShieldService } from "./services/shield/shield.service";
import { HealthcheckService } from "./services/healthcheck/healthcheck.service";
import { writePidFile, removePidFile, ensureDirectories } from "./utils/directories";
import { daemonLogger, createServiceLogger } from "./utils/logger";
import { HC_CRON, Duration } from "./types/constants";
import { Service } from "./services/base/service";

const log = createServiceLogger("daemon", true);

// ─── Service Instances ────────────────────────────────────────────────────

let authService: AuthService;
let configService: ConfigService;
let shieldService: ShieldService;
let healthcheckService: HealthcheckService;
let scheduler: ToadScheduler;

// ─── Initialization ───────────────────────────────────────────────────────

async function initializeServices(): Promise<void> {
  log.info("Initializing daemon services...");

  authService = new AuthService();
  await authService.init();

  configService = new ConfigService(authService);
  await configService.init();

  shieldService = new ShieldService(configService);
  await shieldService.init();

  healthcheckService = new HealthcheckService(shieldService, configService);
  await healthcheckService.init();

  // Wire up service log alerts so critical errors are sent to backend
  Service.setApiClientFactory(async () => {
    try {
      const result = await configService.getAuthenticatedApiClient();
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  });

  // Try to refresh config on startup if authenticated
  if (authService.isAuthenticated()) {
    try {
      await configService.pullConfig();
      log.info("Configuration refreshed on startup");

      // Initialize shield context
      const shieldAlive = await shieldService.pingAgent();
      if (shieldAlive) {
        await shieldService.initializeShield();
        log.info("Shield context initialized");
      }
    } catch (err: any) {
      log.warn(`Startup config refresh failed: ${err.message}`);
    }
  } else {
    log.warn("Not authenticated. Daemon will run with limited functionality.");
    log.warn("Run 'aegis auth login' to authenticate.");
  }

  log.info("All services initialized");
}

// ─── Scheduled Tasks ──────────────────────────────────────────────────────

function setupScheduler(): void {
  scheduler = new ToadScheduler();

  // Daily healthcheck at 2 PM (matching Electron app's HC_CRON = "0 14 * * *")
  const healthcheckTask = new AsyncTask(
    "daily-healthcheck",
    async () => {
      log.info("Starting scheduled healthcheck...");
      try {
        // Refresh token if needed
        if (authService.isAuthenticated()) {
          const tokenResult = await authService.acquireTokenSilent();
          if (!tokenResult.success) {
            log.warn("Token refresh failed for scheduled healthcheck");
          }
        }

        const result = await healthcheckService.runAllTests();
        if (result.success) {
          const report = result.data;
          const passCount = report.results.filter((r) => r.passed).length;
          log.info(
            `Scheduled healthcheck complete: ${passCount}/${report.results.length} passed (${report.overallCompliant ? "COMPLIANT" : "NON-COMPLIANT"})`
          );
        } else {
          log.error(`Scheduled healthcheck failed: ${result.error}`);
        }
      } catch (err: any) {
        log.error(`Scheduled healthcheck error: ${err.message}`);
      }
    },
    (err) => {
      log.error(`Healthcheck task error: ${err.message}`);
    }
  );

  const healthcheckJob = new CronJob({ cronExpression: HC_CRON }, healthcheckTask, {
    preventOverrun: true,
  });

  scheduler.addCronJob(healthcheckJob);
  log.info(`Scheduled daily healthcheck (cron: ${HC_CRON})`);

  // Shield keepalive check every 5 minutes
  const shieldKeepAliveTask = new AsyncTask(
    "shield-keepalive",
    async () => {
      const isAlive = await shieldService.pingAgent();
      if (!isAlive) {
        log.warn("Shield daemon not reachable. Will retry on next check.");
      }
    },
    (err) => {
      log.error(`Shield keepalive error: ${err.message}`);
    }
  );

  const shieldKeepAliveJob = new SimpleIntervalJob(
    { milliseconds: 5 * Duration.MINUTE, runImmediately: false },
    shieldKeepAliveTask,
    { preventOverrun: true }
  );

  scheduler.addSimpleIntervalJob(shieldKeepAliveJob);
  log.info("Scheduled shield keepalive (every 5 minutes)");

  // Config refresh every 12 hours
  const configRefreshTask = new AsyncTask(
    "config-refresh",
    async () => {
      if (!authService.isAuthenticated()) return;
      try {
        await configService.pullConfig();
        log.info("Config refreshed by scheduler");
      } catch (err: any) {
        log.warn(`Scheduled config refresh failed: ${err.message}`);
      }
    },
    (err) => {
      log.error(`Config refresh error: ${err.message}`);
    }
  );

  const configRefreshJob = new SimpleIntervalJob(
    { milliseconds: 12 * Duration.HOUR, runImmediately: false },
    configRefreshTask,
    { preventOverrun: true }
  );

  scheduler.addSimpleIntervalJob(configRefreshJob);
  log.info("Scheduled config refresh (every 12 hours)");
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────

function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}. Shutting down gracefully...`);

    if (scheduler) {
      scheduler.stop();
      log.info("Scheduler stopped");
    }

    removePidFile();
    log.info("Daemon shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    log.error(`Uncaught exception: ${err.message}`);
    log.error(err.stack || "");
  });
  process.on("unhandledRejection", (reason: any) => {
    log.error(`Unhandled rejection: ${reason?.message || reason}`);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.info("═══════════════════════════════════════");
  log.info("  Aegis CLI Daemon starting...");
  log.info("═══════════════════════════════════════");

  // Ensure required directories exist
  ensureDirectories();

  // Write PID file
  writePidFile();
  log.info(`PID: ${process.pid}`);

  // Setup shutdown handlers
  setupShutdownHandlers();

  // Initialize services
  await initializeServices();

  // Setup scheduled tasks
  setupScheduler();

  log.info("Daemon is running. Waiting for scheduled tasks...");

  // Run an initial healthcheck 30 seconds after startup
  setTimeout(async () => {
    if (authService.isAuthenticated()) {
      log.info("Running initial healthcheck...");
      try {
        const result = await healthcheckService.runAllTests();
        if (result.success) {
          const report = result.data;
          log.info(
            `Initial healthcheck: ${report.results.filter((r) => r.passed).length}/${report.results.length} passed`
          );
        }
      } catch (err: any) {
        log.warn(`Initial healthcheck failed: ${err.message}`);
      }
    }
  }, 30 * 1000);
}

main().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  removePidFile();
  process.exit(1);
});
