import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";

/**
 * Register the uninstall command.
 * Completely removes Aegis CLI and Shield from the device.
 */
export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Completely remove Aegis CLI and Shield daemon from this device")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options) => {
      if (!options.yes) {
        const readline = await import("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const confirmed = await new Promise<boolean>((resolve) => {
          rl.question(
            chalk.yellow(
              "This will remove Aegis CLI, Shield daemon, all credentials, logs, and config.\n" +
              "Are you sure? (yes/no): "
            ),
            (answer) => {
              rl.close();
              resolve(answer.toLowerCase() === "yes");
            }
          );
        });

        if (!confirmed) {
          console.log(chalk.dim("Uninstall cancelled."));
          return;
        }
      }

      const platform = process.platform;
      const home = os.homedir();
      const steps: { label: string; fn: () => void }[] = [];

      if (platform === "linux") {
        steps.push(
          {
            label: "Stop and disable Shield systemd service",
            fn: () => {
              run("sudo systemctl stop atomus-shield 2>/dev/null || true");
              run("sudo systemctl disable atomus-shield 2>/dev/null || true");
            },
          },
          {
            label: "Remove Shield systemd service file",
            fn: () => {
              run("sudo rm -f /etc/systemd/system/atomus-shield.service");
              run("sudo rm -f /usr/lib/systemd/system/atomus-shield.service");
              run("sudo systemctl daemon-reload");
            },
          },
          {
            label: "Remove Shield binary and data",
            fn: () => run("sudo rm -rf /opt/atomus-shield"),
          },
          {
            label: "Remove Aegis CLI data and logs",
            fn: () => {
              run("sudo rm -rf /var/lib/aegis-cli");
              run("sudo rm -rf /var/log/aegis-cli");
              run("sudo rm -f /var/run/aegis-cli.pid");
              run("sudo rm -f /var/run/aegis-cli.sock");
            },
          },
          {
            label: "Remove Aegis CLI binary",
            fn: () => run("sudo rm -f /usr/local/bin/aegis"),
          },
          {
            label: "Remove temp install files",
            fn: () => run("sudo rm -rf /tmp/aegis-shield-install"),
          }
        );
      } else if (platform === "darwin") {
        steps.push(
          {
            label: "Unload Shield launch daemon",
            fn: () =>
              run(
                "sudo launchctl unload /Library/LaunchDaemons/com.atomuscyber.shield.plist 2>/dev/null || true"
              ),
          },
          {
            label: "Remove Shield launch daemon and binary",
            fn: () => {
              run("sudo rm -f /Library/LaunchDaemons/com.atomuscyber.shield.plist");
              run("sudo rm -rf '/Library/Application Support/com.atomuscyber.shield'");
            },
          },
          {
            label: "Remove Aegis CLI binary",
            fn: () => run("sudo rm -f /usr/local/bin/aegis"),
          },
          {
            label: "Remove temp install files",
            fn: () => run("sudo rm -rf /tmp/aegis-shield-install"),
          }
        );
      }

      // User-level cleanup (no sudo needed) — same for all platforms
      steps.push({
        label: "Remove credentials, config, and cache",
        fn: () => {
          const userDir = `${home}/.atomus`;
          if (fs.existsSync(userDir)) {
            fs.rmSync(userDir, { recursive: true, force: true });
          }
        },
      });

      console.log(chalk.bold("\n  Uninstalling Aegis...\n"));

      let allOk = true;
      for (const step of steps) {
        try {
          process.stdout.write(`  ${chalk.dim(step.label)}... `);
          step.fn();
          console.log(chalk.green("done"));
        } catch (err: any) {
          console.log(chalk.red("failed"));
          console.log(chalk.dim(`    ${err.message}`));
          allOk = false;
        }
      }

      console.log();
      if (allOk) {
        console.log(chalk.green("  Aegis has been completely removed from this device."));
      } else {
        console.log(
          chalk.yellow("  Uninstall completed with some errors (see above).")
        );
        console.log(
          chalk.dim("  You may need to run some steps manually with sudo.")
        );
      }
      console.log();
    });
}

function run(cmd: string): void {
  execSync(cmd, { stdio: "pipe" });
}
