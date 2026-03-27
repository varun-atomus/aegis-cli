import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ShieldService } from "../services/shield/shield.service";

/**
 * Register shield commands: status, install.
 */
export function registerShieldCommands(
  program: Command,
  getServices: () => Promise<{ shield: ShieldService }>
): void {
  const shield = program
    .command("shield")
    .description("Manage the Atomus Shield daemon");

  // ─── aegis shield status ──────────────────────────────────────────

  shield
    .command("status")
    .description("Check Shield daemon status")
    .action(async () => {
      const { shield: shieldService } = await getServices();
      const alive = await shieldService.pingAgent();

      if (alive) {
        const info = await shieldService.getInfo();
        if (info.success) {
          console.log(chalk.green(`● Shield is running`));
          console.log(chalk.dim(`  PID: ${info.data.pid}`));
          console.log(chalk.dim(`  Version: ${info.data.version}`));
        } else {
          console.log(chalk.green("● Shield is running"));
        }
      } else {
        console.log(chalk.red("● Shield is offline"));
        const sysStatus = await shieldService.getSystemdStatus();
        if (sysStatus) {
          console.log(chalk.dim(`  systemd: ${sysStatus}`));
        }
      }
    });

  // ─── aegis shield install ─────────────────────────────────────────

  shield
    .command("install")
    .description("Download and install the Shield daemon")
    .option(
      "-c, --connection-string <string>",
      "Azure Blob Storage connection string (bypasses backend lookup)"
    )
    .action(async (options) => {
      const { shield: shieldService } = await getServices();

      const spinner = ora("Installing Shield daemon...").start();

      const result = await (shieldService as any).downloadAndInstallShield(
        options.connectionString
      );

      if (result.success) {
        spinner.succeed("Shield daemon installed successfully");
        const alive = await shieldService.pingAgent();
        if (alive) {
          console.log(chalk.green("  Shield is now running"));
        } else {
          console.log(
            chalk.yellow("  Shield installed but not yet reachable — check: ") +
              chalk.cyan("systemctl status atomus-shield")
          );
        }
      } else {
        spinner.fail(`Shield install failed: ${result.error}`);
      }
    });

  // ─── aegis shield start ───────────────────────────────────────────

  shield
    .command("start")
    .description("Start the Shield systemd service")
    .action(async () => {
      const { shield: shieldService } = await getServices();
      const spinner = ora("Starting Shield...").start();
      const result = await shieldService.startShieldService();
      if (result.success) {
        spinner.succeed("Shield service started");
      } else {
        spinner.fail(`Failed to start Shield: ${result.error}`);
      }
    });
}
