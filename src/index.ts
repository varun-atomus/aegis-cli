#!/usr/bin/env node

// Load .env before anything else
import "./utils/env";

/**
 * Aegis CLI - Entry Point
 *
 * Standalone, terminal-based CLI application for device compliance monitoring
 * on headless Linux servers. Replaces the Electron-based GUI for environments
 * without a graphical desktop.
 *
 * Usage:
 *   aegis auth login          - Authenticate with device code flow
 *   aegis config pull         - Pull configuration from Atomus API
 *   aegis config init         - Full initialization (config + shield + healthcheck)
 *   aegis compliance run      - Run all compliance tests
 *   aegis compliance test <n> - Run a specific compliance test
 *   aegis daemon start        - Start the background daemon
 *   aegis status              - Show device and service status
 */

import { Command } from "commander";
import chalk from "chalk";
import { APP_VERSION, APP_NAME } from "./types/constants";
import {
  registerAuthCommands,
  registerStatusCommand,
  registerComplianceCommands,
  registerDaemonCommands,
  registerConfigCommands,
  registerStartCommand,
  registerShieldCommands,
  registerUninstallCommand,
} from "./commands";
import { AuthService } from "./services/auth/auth.service";
import { ConfigService } from "./services/config/config.service";
import { ShieldService } from "./services/shield/shield.service";
import { OsqueryService } from "./services/osquery/osquery.service";
import { HealthcheckService } from "./services/healthcheck/healthcheck.service";
import { ensureUserDirectories } from "./utils/directories";
import { Service } from "./services/base/service";

// ─── Service Singletons (lazy-initialized) ──────────────────────────────

let _authService: AuthService | null = null;
let _configService: ConfigService | null = null;
let _shieldService: ShieldService | null = null;
let _osqueryService: OsqueryService | null = null;
let _healthcheckService: HealthcheckService | null = null;

async function getAuthService(): Promise<AuthService> {
  if (!_authService) {
    _authService = new AuthService();
    await _authService.init();
  }
  return _authService;
}

async function getConfigService(): Promise<ConfigService> {
  const auth = await getAuthService();
  if (!_configService) {
    _configService = new ConfigService(auth);
    await _configService.init();
  }
  return _configService;
}

async function getShieldService(): Promise<ShieldService> {
  const config = await getConfigService();
  if (!_shieldService) {
    _shieldService = new ShieldService(config);
    await _shieldService.init();
  }
  return _shieldService;
}

async function getOsqueryService(): Promise<OsqueryService> {
  const config = await getConfigService();
  if (!_osqueryService) {
    _osqueryService = new OsqueryService(config);
    await _osqueryService.init();
  }
  return _osqueryService;
}

async function getHealthcheckService(): Promise<HealthcheckService> {
  const shield = await getShieldService();
  const config = await getConfigService();
  if (!_healthcheckService) {
    _healthcheckService = new HealthcheckService(shield, config);
    await _healthcheckService.init();
  }
  return _healthcheckService;
}

async function getAllServices() {
  const auth = await getAuthService();
  const config = await getConfigService();
  const shield = await getShieldService();
  const osquery = await getOsqueryService();
  const healthcheck = await getHealthcheckService();
  return { auth, config, shield, osquery, healthcheck };
}

// ─── Wire up service log alerts ─────────────────────────────────────────
// Inject the API client factory so critical errors in any service
// are automatically reported to the backend (matching Mac app pattern).
Service.setApiClientFactory(async () => {
  try {
    const config = await getConfigService();
    const result = await config.getAuthenticatedApiClient();
    return result.success ? result.data : null;
  } catch {
    return null;
  }
});

// ─── CLI Setup ──────────────────────────────────────────────────────────

const program = new Command();

program
  .name(APP_NAME)
  .description(
    "Atomus Aegis CLI - Device compliance monitoring for Linux servers"
  )
  .version(APP_VERSION, "-v, --version");

// Register command groups
registerAuthCommands(program, getAuthService);
registerConfigCommands(program, async () => ({
  config: await getConfigService(),
  shield: await getShieldService(),
}));
registerStatusCommand(program, getAllServices);
registerComplianceCommands(program, getHealthcheckService);
registerDaemonCommands(program);
registerStartCommand(program, async () => ({
  auth: await getAuthService(),
  config: await getConfigService(),
  shield: await getShieldService(),
  osquery: await getOsqueryService(),
}));
registerShieldCommands(program, async () => ({ shield: await getShieldService() }));
registerUninstallCommand(program);

// ─── Update Command ─────────────────────────────────────────────────────

program
  .command("update")
  .description("Check for and install CLI updates")
  .action(async () => {
    console.log(chalk.yellow("Update checking is not yet implemented."));
    console.log(
      chalk.dim(
        "For now, download the latest version from the Atomus portal."
      )
    );
  });

// ─── Global Error Handling ──────────────────────────────────────────────

program.hook("preAction", () => {
  ensureUserDirectories();
});

// ─── Parse and Execute ──────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});
