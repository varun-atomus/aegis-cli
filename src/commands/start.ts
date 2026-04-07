import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { spawn } from "child_process";
import path from "path";
import { AuthService } from "../services/auth/auth.service";
import { ConfigService } from "../services/config/config.service";
import { ShieldService } from "../services/shield/shield.service";
import { OsqueryService } from "../services/osquery/osquery.service";
import { CloudInstance } from "../types";
import { isDaemonRunning } from "../utils/directories";

/**
 * Register `aegis start` bootstrap command.
 * Runs first-time setup in one flow and starts daemon.
 */
export function registerStartCommand(
  program: Command,
  getServices: () => Promise<{
    auth: AuthService;
    config: ConfigService;
    shield: ShieldService;
    osquery: OsqueryService;
  }>
): void {
  program
    .command("start")
    .description(
      "Bootstrap auth/config/shield and start daemon in one command"
    )
    .option(
      "-c, --cloud <instance>",
      "Cloud instance: commercial or gov",
      "commercial"
    )
    .option(
      "-e, --email <email>",
      "Email address (used to auto-detect cloud instance)"
    )
    .option("--force-pull", "Always pull fresh config before start")
    .action(async (options) => {
      const { auth, config, shield, osquery } = await getServices();

      let cloudInstance: CloudInstance = options.cloud as CloudInstance;
      if (options.email) {
        cloudInstance = auth.detectCloudInstance(options.email);
      }

      // 1) Authenticate if needed
      if (!auth.isAuthenticated()) {
        console.log(chalk.blue("\nAuthentication required.\n"));
        const authResult = await auth.loginWithDeviceCode(
          cloudInstance,
          (message, userCode, verificationUri) => {
            console.log(chalk.yellow("━".repeat(60)));
            console.log();
            console.log(chalk.bold("  To sign in, open a browser and go to:"));
            console.log(chalk.cyan(`  ${verificationUri}`));
            console.log();
            console.log(
              chalk.bold("  Enter the code: ") + chalk.green.bold(userCode)
            );
            console.log();
            console.log(chalk.yellow("━".repeat(60)));
            console.log();
            console.log(chalk.dim("Waiting for authentication..."));
          }
        );

        if (!authResult.success) {
          console.error(chalk.red("✗ Authentication failed: ") + authResult.error);
          process.exit(1);
        }

        console.log(chalk.green("\n✓ Authenticated\n"));
      } else {
        const creds = auth.getStoredCredentials();
        console.log(
          chalk.green("✓ ") +
            chalk.dim(
              `Already authenticated as ${creds?.email || "current user"}`
            )
        );
      }

      // 2) Pull config if missing (or forced)
      const hasConfig = !!config.getConfig();
      if (options.forcePull || !hasConfig) {
        const configSpinner = ora("Pulling configuration...").start();
        const configResult = await config.pullConfig();
        if (!configResult.success) {
          configSpinner.fail(`Failed to pull config: ${configResult.error}`);
          process.exit(1);
        }
        configSpinner.succeed("Configuration pulled and cached");
      } else {
        console.log(chalk.green("✓ ") + chalk.dim("Configuration already cached"));
      }

      // 3) Initialize shield context when reachable
      const shieldSpinner = ora("Checking Shield daemon...").start();
      const shieldAlive = await shield.pingAgent();
      if (!shieldAlive) {
        shieldSpinner.warn("Shield daemon not reachable; continuing");
      } else {
        const initResult = await shield.initializeShield();
        if (initResult.success) {
          shieldSpinner.succeed("Shield context initialized");
        } else {
          shieldSpinner.warn(`Shield init skipped: ${initResult.error}`);
        }
      }

      // 4) Setup osquery (install binary + download configs + launch)
      if (process.platform === "linux") {
        const osquerySpinner = ora("Setting up osquery...").start();
        if (osquery.isOsquerydRunning()) {
          osquerySpinner.succeed("osqueryd already running");
        } else {
          const osqueryResult = await osquery.setupOsquery();
          if (osqueryResult.success && osquery.isOsquerydRunning()) {
            osquerySpinner.succeed("osqueryd installed and running");
          } else if (!osqueryResult.success) {
            osquerySpinner.warn(`osquery setup: ${osqueryResult.error}`);
          } else {
            osquerySpinner.warn("osquery setup: osqueryd not running after setup");
          }
        }
      }

      // 5) Start daemon if not running
      const daemonStatus = isDaemonRunning();
      if (daemonStatus.running) {
        console.log(
          chalk.green("✓ ") +
            chalk.dim(`Daemon already running (PID: ${daemonStatus.pid})`)
        );
      } else {
        const daemonPath = path.resolve(__dirname, "../daemon.js");
        const daemonSpinner = ora("Starting daemon...").start();
        try {
          const child = spawn(process.execPath, [daemonPath], {
            detached: true,
            stdio: "ignore",
            env: { ...process.env },
          });
          child.unref();

          await new Promise((resolve) => setTimeout(resolve, 1500));
          const newStatus = isDaemonRunning();
          if (newStatus.running) {
            daemonSpinner.succeed(`Daemon started (PID: ${newStatus.pid})`);
          } else {
            daemonSpinner.fail("Daemon may have exited; check daemon logs");
          }
        } catch (err: any) {
          daemonSpinner.fail(`Failed to start daemon: ${err.message}`);
          process.exit(1);
        }
      }

      console.log();
      console.log(chalk.green("✓ ") + chalk.bold("Aegis bootstrap complete."));
      console.log(
        chalk.dim("Run ") + chalk.cyan("aegis status") + chalk.dim(" to verify.")
      );
      console.log();
    });
}
