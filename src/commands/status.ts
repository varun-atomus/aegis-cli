import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { AuthService } from "../services/auth/auth.service";
import { ConfigService } from "../services/config/config.service";
import { ShieldService } from "../services/shield/shield.service";
import { OsqueryService } from "../services/osquery/osquery.service";
import { HealthcheckService } from "../services/healthcheck/healthcheck.service";
import { getDeviceInfo } from "../utils/device-info";
import { isDaemonRunning } from "../utils/directories";

/**
 * Register the status command.
 * Shows overall system status: auth, config, shield, daemon, last healthcheck.
 */
export function registerStatusCommand(
  program: Command,
  getServices: () => Promise<{
    auth: AuthService;
    config: ConfigService;
    shield: ShieldService;
    osquery: OsqueryService;
    healthcheck: HealthcheckService;
  }>
): void {
  program
    .command("status")
    .description("Show device and service status")
    .option("-j, --json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Checking status...").start();

      try {
        const { auth, config, shield, osquery } = await getServices();
        const deviceInfo = getDeviceInfo();
        const daemonStatus = isDaemonRunning();

        // Check shield connectivity
        const shieldAlive = await shield.pingAgent();
        let shieldInfo: any = null;
        if (shieldAlive) {
          const info = await shield.getInfo();
          if (info.success) {
            shieldInfo = info.data;
          }
        }

        // Auth status
        const creds = auth.getStoredCredentials();
        const isAuthenticated = auth.isAuthenticated();

        // Config status
        const lastConfigPull = config.getLastPullTime();

        // Osquery status (Linux only)
        const osqueryRunning = process.platform === "linux" && osquery.isOsquerydRunning();

        spinner.stop();

        if (options.json) {
          const jsonOutput = {
            device: deviceInfo,
            auth: {
              authenticated: isAuthenticated,
              email: creds?.email || null,
              tenantId: creds?.tenantId || null,
              cloudInstance: creds?.cloudInstance || null,
            },
            shield: {
              running: shieldAlive,
              pid: shieldInfo?.pid || null,
              version: shieldInfo?.version || null,
            },
            osquery: {
              running: osqueryRunning,
              installed: process.platform === "linux" && osquery.isOsqueryInstalled(),
            },
            daemon: daemonStatus,
            config: {
              lastPull: lastConfigPull,
            },
          };
          console.log(JSON.stringify(jsonOutput, null, 2));
          return;
        }

        // ─── Pretty Output ──────────────────────────────────

        console.log(chalk.bold("\n  Aegis CLI Status\n"));

        // Device info
        const deviceTable = new Table({
          chars: {
            top: "", "top-mid": "", "top-left": "", "top-right": "",
            bottom: "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
            left: "  ", "left-mid": "", mid: "", "mid-mid": "",
            right: "", "right-mid": "", middle: "  ",
          },
          style: { "padding-left": 0, "padding-right": 1 },
        });

        deviceTable.push(
          [chalk.dim("Device"), chalk.bold(deviceInfo.deviceName)],
          [chalk.dim("Username"), deviceInfo.username],
          [chalk.dim("Platform"), deviceInfo.platform],
          [chalk.dim("CLI Version"), deviceInfo.aegisVersion]
        );
        console.log(deviceTable.toString());
        console.log();

        // Service statuses
        const statusTable = new Table({
          head: [
            chalk.dim("Service"),
            chalk.dim("Status"),
            chalk.dim("Details"),
          ],
          chars: {
            top: "─", "top-mid": "┬", "top-left": "  ┌", "top-right": "┐",
            bottom: "─", "bottom-mid": "┴", "bottom-left": "  └", "bottom-right": "┘",
            left: "  │", "left-mid": "  ├", mid: "─", "mid-mid": "┼",
            right: "│", "right-mid": "┤", middle: "│",
          },
        });

        // Auth
        statusTable.push([
          "Authentication",
          isAuthenticated ? chalk.green("● Active") : chalk.red("● Inactive"),
          isAuthenticated
            ? `${creds?.email} (${creds?.cloudInstance})`
            : 'Run "aegis auth login"',
        ]);

        // Config
        statusTable.push([
          "Configuration",
          lastConfigPull ? chalk.green("● Cached") : chalk.yellow("● Not pulled"),
          lastConfigPull
            ? `Last pull: ${lastConfigPull}`
            : 'Run "aegis config pull"',
        ]);

        // Shield
        statusTable.push([
          "Atomus Shield",
          shieldAlive ? chalk.green("● Running") : chalk.red("● Offline"),
          shieldAlive
            ? `PID: ${shieldInfo?.pid || "?"}, v${shieldInfo?.version || "?"}`
            : "Shield daemon not reachable",
        ]);

        // Osquery (Linux only)
        if (process.platform === "linux") {
          statusTable.push([
            "Osquery",
            osqueryRunning ? chalk.green("● Running") : chalk.red("● Offline"),
            osqueryRunning
              ? "osqueryd daemon active"
              : osquery.isOsqueryInstalled()
                ? "Installed but not running"
                : "Not installed",
          ]);
        }

        // Daemon
        statusTable.push([
          "CLI Daemon",
          daemonStatus.running
            ? chalk.green("● Running")
            : chalk.yellow("● Stopped"),
          daemonStatus.running
            ? `PID: ${daemonStatus.pid}`
            : 'Run "aegis daemon start"',
        ]);

        console.log(statusTable.toString());
        console.log();
      } catch (err: any) {
        spinner.fail("Failed to check status");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
}
