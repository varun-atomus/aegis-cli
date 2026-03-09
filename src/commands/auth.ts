import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { AuthService } from "../services/auth/auth.service";
import { CloudInstance } from "../types";

/**
 * Register auth commands: login, logout, status, token.
 */
export function registerAuthCommands(
  program: Command,
  getAuthService: () => Promise<AuthService>
): void {
  const auth = program
    .command("auth")
    .description("Authentication management");

  // ─── aegis auth login ────────────────────────────────────────────

  auth
    .command("login")
    .description("Authenticate using device code flow")
    .option(
      "-c, --cloud <instance>",
      "Cloud instance: commercial or gov",
      "commercial"
    )
    .option("-e, --email <email>", "Email address (used to auto-detect cloud instance)")
    .action(async (options) => {
      const authService = await getAuthService();

      let cloudInstance: CloudInstance = options.cloud as CloudInstance;

      // Auto-detect cloud instance from email if provided
      if (options.email) {
        cloudInstance = authService.detectCloudInstance(options.email);
        console.log(
          chalk.dim(
            `Detected cloud instance: ${chalk.bold(cloudInstance)} (from ${options.email})`
          )
        );
      }

      console.log(
        chalk.blue(
          `\nStarting device code authentication (${cloudInstance} cloud)...\n`
        )
      );

      const result = await authService.loginWithDeviceCode(
        cloudInstance,
        (message, userCode, verificationUri) => {
          console.log(chalk.yellow("━".repeat(60)));
          console.log();
          console.log(
            chalk.bold("  To sign in, open a browser and go to:")
          );
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

      if (result.success) {
        console.log();
        console.log(
          chalk.green("✓ ") +
            chalk.bold("Authenticated successfully!")
        );
        console.log(chalk.dim(`  Email:    ${result.data.email}`));
        console.log(chalk.dim(`  Tenant:   ${result.data.tenantId}`));
        console.log(chalk.dim(`  Cloud:    ${result.data.cloudInstance}`));
        console.log();
        console.log(
          chalk.dim("Run ") +
            chalk.cyan("aegis status") +
            chalk.dim(" to see device compliance status.")
        );
      } else {
        console.error(chalk.red("✗ Authentication failed: ") + result.error);
        process.exit(1);
      }
    });

  // ─── aegis auth logout ───────────────────────────────────────────

  auth
    .command("logout")
    .description("Clear stored credentials")
    .action(async () => {
      const authService = await getAuthService();
      authService.logout();
      console.log(chalk.green("✓ ") + "Logged out successfully.");
    });

  // ─── aegis auth status ───────────────────────────────────────────

  auth
    .command("status")
    .description("Show current authentication status")
    .action(async () => {
      const authService = await getAuthService();
      const creds = authService.getStoredCredentials();

      if (!creds) {
        console.log(chalk.yellow("Not authenticated."));
        console.log(
          chalk.dim("Run ") +
            chalk.cyan("aegis auth login") +
            chalk.dim(" to authenticate.")
        );
        return;
      }

      const isValid = authService.isAuthenticated();
      const isEnvToken = authService.hasEnvToken();

      console.log(chalk.bold("Authentication Status\n"));
      if (isEnvToken) {
        console.log(`  Source:     ${chalk.cyan("AEGIS_TOKEN env var")}`);
      }
      console.log(`  Email:      ${creds.email || chalk.dim("(not available)")}`);
      console.log(`  Tenant:     ${creds.tenantId || chalk.dim("(not available)")}`);
      console.log(`  Cloud:      ${creds.cloudInstance}`);
      console.log(
        `  Token:      ${isValid ? chalk.green("Valid") : chalk.red("Expired")}`
      );
      if (creds.expiresOn) {
        console.log(`  Expires:    ${creds.expiresOn}`);
      }
    });

  // ─── aegis auth token ────────────────────────────────────────────

  auth
    .command("token")
    .description("Get a fresh access token (for scripting)")
    .action(async () => {
      const authService = await getAuthService();
      const spinner = ora("Acquiring token...").start();

      const result = await authService.acquireTokenSilent();

      if (result.success) {
        spinner.stop();
        // Output just the token for piping
        process.stdout.write(result.data.accessToken);
      } else {
        spinner.fail("Failed to acquire token");
        console.error(chalk.red(result.error));
        process.exit(1);
      }
    });
}
