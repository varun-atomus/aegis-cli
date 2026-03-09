import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ConfigService } from "../services/config/config.service";
import { ShieldService } from "../services/shield/shield.service";

/**
 * Register config commands: pull, show, init.
 */
export function registerConfigCommands(
  program: Command,
  getServices: () => Promise<{
    config: ConfigService;
    shield: ShieldService;
  }>
): void {
  const config = program
    .command("config")
    .description("Configuration management");

  // ─── aegis config pull ───────────────────────────────────────────

  config
    .command("pull")
    .description("Pull fresh configuration from Atomus API")
    .action(async () => {
      const spinner = ora("Pulling configuration...").start();

      try {
        const { config: configService } = await getServices();
        const result = await configService.pullConfig();

        if (result.success) {
          spinner.succeed("Configuration pulled and cached successfully");
          console.log(
            chalk.dim(`  Config keys: ${Object.keys(result.data).length}`)
          );
        } else {
          spinner.fail(`Failed to pull config: ${result.error}`);
          process.exit(1);
        }
      } catch (err: any) {
        spinner.fail(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ─── aegis config show ───────────────────────────────────────────

  config
    .command("show")
    .description("Show cached configuration")
    .option("-k, --key <key>", "Show a specific config key")
    .option("-j, --json", "Output as JSON")
    .action(async (options) => {
      const { config: configService } = await getServices();
      const cachedConfig = configService.getConfig();

      if (!cachedConfig) {
        console.log(chalk.yellow("No cached configuration found."));
        console.log(
          chalk.dim("Run ") +
            chalk.cyan("aegis config pull") +
            chalk.dim(" to fetch configuration.")
        );
        return;
      }

      if (options.key) {
        const value = cachedConfig[options.key];
        if (value === undefined) {
          console.log(
            chalk.yellow(`Key "${options.key}" not found in config.`)
          );
          return;
        }
        if (options.json || typeof value === "object") {
          console.log(JSON.stringify(value, null, 2));
        } else {
          console.log(value);
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(cachedConfig, null, 2));
        return;
      }

      // List config keys
      console.log(chalk.bold("\n  Cached Configuration\n"));
      console.log(
        chalk.dim(
          `  Last pull: ${configService.getLastPullTime() || "unknown"}`
        )
      );
      console.log();

      for (const key of Object.keys(cachedConfig).sort()) {
        const value = cachedConfig[key];
        const preview =
          typeof value === "object"
            ? chalk.dim(`{...} (${Object.keys(value).length} keys)`)
            : chalk.dim(
                String(value).length > 60
                  ? String(value).substring(0, 60) + "..."
                  : String(value)
              );
        console.log(`  ${chalk.cyan(key.padEnd(30))} ${preview}`);
      }
      console.log();
    });

  // ─── aegis config init ───────────────────────────────────────────

  config
    .command("init")
    .description(
      "Initialize services (pull config + init shield + first healthcheck)"
    )
    .action(async () => {
      const { config: configService, shield: shieldService } =
        await getServices();

      // Step 1: Pull config
      const configSpinner = ora("Pulling configuration...").start();
      const configResult = await configService.pullConfig();
      if (!configResult.success) {
        configSpinner.fail(`Config pull failed: ${configResult.error}`);
        process.exit(1);
      }
      configSpinner.succeed("Configuration pulled");

      // Step 2: Initialize shield
      const shieldSpinner = ora("Initializing shield context...").start();
      const shieldAlive = await shieldService.pingAgent();
      if (!shieldAlive) {
        shieldSpinner.warn(
          "Shield daemon not reachable. Skipping shield init."
        );
        console.log(
          chalk.dim("  Ensure atomus-shield service is running.")
        );
      } else {
        const shieldResult = await shieldService.initializeShield();
        if (shieldResult.success) {
          shieldSpinner.succeed("Shield context initialized");
        } else {
          shieldSpinner.warn(`Shield init: ${(shieldResult as any).error}`);
        }
      }

      console.log();
      console.log(chalk.green("✓ ") + chalk.bold("Initialization complete!"));
      console.log(
        chalk.dim("  Run ") +
          chalk.cyan("aegis compliance run") +
          chalk.dim(" to check compliance.")
      );
      console.log(
        chalk.dim("  Run ") +
          chalk.cyan("aegis daemon start") +
          chalk.dim(" to start automated monitoring.")
      );
      console.log();
    });
}
