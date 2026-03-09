import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { HealthcheckService } from "../services/healthcheck/healthcheck.service";
import { HealthcheckTests } from "../types/constants";

/**
 * Register compliance commands: run, test, list.
 */
export function registerComplianceCommands(
  program: Command,
  getHealthcheckService: () => Promise<HealthcheckService>
): void {
  const compliance = program
    .command("compliance")
    .description("Device compliance monitoring");

  // ─── aegis compliance run ────────────────────────────────────────

  compliance
    .command("run")
    .description("Run all compliance tests")
    .option("-j, --json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Running compliance healthcheck...").start();

      try {
        const hcService = await getHealthcheckService();
        const result = await hcService.runAllTests();

        spinner.stop();

        if (!result.success) {
          console.error(chalk.red("✗ Failed to run healthcheck: ") + result.error);
          process.exit(1);
        }

        const report = result.data;

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        // Pretty output
        console.log(
          chalk.bold(`\n  Compliance Report - ${report.deviceName}\n`)
        );

        const table = new Table({
          head: [
            chalk.dim("Test"),
            chalk.dim("Result"),
            chalk.dim("Details"),
          ],
          colWidths: [25, 12, 50],
          wordWrap: true,
          chars: {
            top: "─", "top-mid": "┬", "top-left": "  ┌", "top-right": "┐",
            bottom: "─", "bottom-mid": "┴", "bottom-left": "  └", "bottom-right": "┘",
            left: "  │", "left-mid": "  ├", mid: "─", "mid-mid": "┼",
            right: "│", "right-mid": "┤", middle: "│",
          },
        });

        for (const r of report.results) {
          table.push([
            r.testName,
            r.passed ? chalk.green("PASS") : chalk.red("FAIL"),
            r.details,
          ]);
        }

        console.log(table.toString());
        console.log();

        const passCount = report.results.filter((r) => r.passed).length;
        const totalCount = report.results.length;
        const statusColor = report.overallCompliant
          ? chalk.green
          : chalk.red;

        console.log(
          `  Overall: ${statusColor(report.overallCompliant ? "COMPLIANT" : "NON-COMPLIANT")} (${passCount}/${totalCount} tests passed)`
        );
        console.log(chalk.dim(`  Timestamp: ${report.timestamp}`));
        console.log();
      } catch (err: any) {
        spinner.fail("Healthcheck failed");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ─── aegis compliance test ───────────────────────────────────────

  compliance
    .command("test <testName>")
    .description("Run a specific compliance test")
    .action(async (testName: string) => {
      const spinner = ora(`Running test: ${testName}...`).start();

      try {
        const hcService = await getHealthcheckService();
        const result = await hcService.runTest(testName);

        spinner.stop();

        if (!result.success) {
          console.error(chalk.red("✗ ") + result.error);
          process.exit(1);
        }

        const r = result.data;
        const icon = r.passed ? chalk.green("✓") : chalk.red("✗");
        const status = r.passed ? chalk.green("PASS") : chalk.red("FAIL");

        console.log(`\n  ${icon} ${chalk.bold(r.testName)} - ${status}`);
        console.log(chalk.dim(`  ${r.details}`));
        console.log();
      } catch (err: any) {
        spinner.fail("Test failed");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ─── aegis compliance list ───────────────────────────────────────

  compliance
    .command("list")
    .description("List available compliance tests")
    .action(async () => {
      console.log(chalk.bold("\n  Available Compliance Tests\n"));

      const tests = [
        {
          name: HealthcheckTests.SHIELD_STATUS,
          desc: "Confirm atomus-shield agent health",
        },
        {
          name: HealthcheckTests.DEFENDER,
          desc: "Verify Microsoft Defender for Endpoint installation and status",
        },
        {
          name: HealthcheckTests.DISK_ENCRYPTION,
          desc: "Check disk encryption status (LUKS, dm-crypt)",
        },
        {
          name: HealthcheckTests.FIPS_ENABLED,
          desc: "Validate FIPS 140-2 compliance mode",
        },
        {
          name: HealthcheckTests.OSQUERY_STATUS,
          desc: "Verify osquery daemon and extensions",
        },
        {
          name: HealthcheckTests.CIS_BENCHMARKS,
          desc: "Run CIS Level 1 benchmark checks",
        },
        {
          name: HealthcheckTests.INTUNE,
          desc: "Verify Microsoft Intune installation",
        },
      ];

      for (const test of tests) {
        console.log(
          `  ${chalk.cyan(test.name.padEnd(22))} ${chalk.dim(test.desc)}`
        );
      }
      console.log();
      console.log(
        chalk.dim("  Run a specific test: ") +
          chalk.cyan("aegis compliance test <testName>")
      );
      console.log(
        chalk.dim("  Run all tests:       ") +
          chalk.cyan("aegis compliance run")
      );
      console.log();
    });
}
