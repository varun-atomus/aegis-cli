import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { spawn } from "child_process";
import * as path from "path";
import { isDaemonRunning } from "../utils/directories";
import {
  enableService,
  stopService,
  getServiceStatus,
  daemonReload,
} from "../utils/systemd";

const DAEMON_SERVICE_NAME = "aegis-cli";

/**
 * Register daemon commands: start, stop, restart, status, logs.
 */
export function registerDaemonCommands(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Manage the Aegis CLI daemon");

  daemon
    .command("start")
    .description("Start the Aegis daemon")
    .option("--foreground", "Run in foreground (for debugging)")
    .option("--systemd", "Start using systemd service")
    .action(async (options) => {
      const status = isDaemonRunning();
      if (status.running) {
        console.log(
          chalk.yellow(`Daemon is already running (PID: ${status.pid})`)
        );
        return;
      }

      if (options.systemd) {
        const spinner = ora("Starting aegis-cli service...").start();
        await daemonReload();
        const result = await enableService(DAEMON_SERVICE_NAME);
        if (result.success) {
          spinner.succeed("Aegis daemon started via systemd");
        } else {
          spinner.fail(`Failed to start: ${(result as any).error}`);
          process.exit(1);
        }
        return;
      }

      if (options.foreground) {
        console.log(chalk.dim("Starting daemon in foreground mode..."));
        console.log(chalk.dim("Press Ctrl+C to stop.\n"));
        // Import and run daemon directly
        require("../daemon");
        return;
      }

      // Start as a background process
      const daemonPath = path.resolve(__dirname, "../daemon.js");
      const spinner = ora("Starting daemon...").start();

      try {
        const child = spawn(process.execPath, [daemonPath], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env },
        });

        child.unref();

        // Wait a moment and check if it started
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const newStatus = isDaemonRunning();

        if (newStatus.running) {
          spinner.succeed(
            `Daemon started (PID: ${newStatus.pid})`
          );
        } else {
          spinner.fail(
            "Daemon process started but may have exited. Check logs."
          );
          console.log(
            chalk.dim("  View logs: ") + chalk.cyan("aegis daemon logs")
          );
        }
      } catch (err: any) {
        spinner.fail(`Failed to start daemon: ${err.message}`);
        process.exit(1);
      }
    });

  daemon
    .command("stop")
    .description("Stop the Aegis daemon")
    .option("--systemd", "Stop using systemd service")
    .action(async (options) => {
      if (options.systemd) {
        const spinner = ora("Stopping aegis-cli service...").start();
        const result = await stopService(DAEMON_SERVICE_NAME);
        if (result.success) {
          spinner.succeed("Aegis daemon stopped via systemd");
        } else {
          spinner.fail(`Failed to stop: ${(result as any).error}`);
        }
        return;
      }

      const status = isDaemonRunning();
      if (!status.running || !status.pid) {
        console.log(chalk.yellow("Daemon is not running."));
        return;
      }

      try {
        process.kill(status.pid, "SIGTERM");
        console.log(
          chalk.green("✓ ") +
            `Sent stop signal to daemon (PID: ${status.pid})`
        );

        // Wait for graceful shutdown
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const newStatus = isDaemonRunning();
        if (!newStatus.running) {
          console.log(chalk.green("  Daemon stopped successfully."));
        } else {
          console.log(
            chalk.yellow(
              "  Daemon still running. Use SIGKILL if needed: kill -9 " +
                status.pid
            )
          );
        }
      } catch (err: any) {
        console.error(chalk.red(`Failed to stop daemon: ${err.message}`));
        process.exit(1);
      }
    });

  daemon
    .command("restart")
    .description("Restart the Aegis daemon")
    .action(async () => {
      const status = isDaemonRunning();
      if (status.running && status.pid) {
        console.log(chalk.dim(`Stopping daemon (PID: ${status.pid})...`));
        try {
          process.kill(status.pid, "SIGTERM");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch {}
      }

      // Spawn new daemon
      const daemonPath = path.resolve(__dirname, "../daemon.js");
      const spinner = ora("Restarting daemon...").start();

      const child = spawn(process.execPath, [daemonPath], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();

      await new Promise((resolve) => setTimeout(resolve, 1500));
      const newStatus = isDaemonRunning();

      if (newStatus.running) {
        spinner.succeed(`Daemon restarted (PID: ${newStatus.pid})`);
      } else {
        spinner.fail("Failed to restart daemon. Check logs.");
      }
    });

  // ─── aegis daemon status ─────────────────────────────────────────

  daemon
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      const processStatus = isDaemonRunning();

      // Also check systemd service
      let systemdStatus: any = null;
      try {
        systemdStatus = await getServiceStatus(DAEMON_SERVICE_NAME);
      } catch {}

      console.log(chalk.bold("\n  Aegis Daemon Status\n"));

      if (processStatus.running) {
        console.log(
          chalk.green("  ● Running") +
            chalk.dim(` (PID: ${processStatus.pid})`)
        );
      } else {
        console.log(chalk.red("  ● Stopped"));
      }

      if (systemdStatus) {
        console.log();
        console.log(
          chalk.dim("  Systemd service:  ") +
            (systemdStatus.active
              ? chalk.green("active")
              : chalk.yellow("inactive"))
        );
        console.log(
          chalk.dim("  Systemd enabled:  ") +
            (systemdStatus.enabled
              ? chalk.green("yes")
              : chalk.yellow("no"))
        );
      }

      console.log();
    });

  daemon
    .command("logs")
    .description("View daemon logs")
    .option("-n, --lines <n>", "Number of lines to show", "50")
    .option("-f, --follow", "Follow log output")
    .action(async (options) => {
      const { execSync, spawn: spawnProc } = require("child_process");
      const logPattern = "/var/log/aegis-cli/daemon-*.log";

      try {
        if (options.follow) {
          console.log(chalk.dim("Following daemon logs (Ctrl+C to stop)...\n"));
          const tail = spawnProc("tail", ["-f", "-n", options.lines], {
            stdio: "inherit",
            shell: true,
          });
          tail.on("error", () => {
            console.error(
              chalk.red("Could not follow logs. Check if log files exist.")
            );
          });
        } else {
          const logDir =
            process.env.HOME
              ? `${process.env.HOME}/.atomus/aegis/logs`
              : "/var/log/aegis-cli";
          try {
            const output = execSync(
              `ls -t ${logDir}/daemon-*.log 2>/dev/null | head -1 | xargs tail -n ${options.lines} 2>/dev/null || echo "No daemon logs found."`,
              { encoding: "utf-8" }
            );
            console.log(output);
          } catch {
            console.log(chalk.yellow("No daemon logs found."));
            console.log(
              chalk.dim("Start the daemon first: ") +
                chalk.cyan("aegis daemon start")
            );
          }
        }
      } catch (err: any) {
        console.error(chalk.red(`Error reading logs: ${err.message}`));
      }
    });
}
