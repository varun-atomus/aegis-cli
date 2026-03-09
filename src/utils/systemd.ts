import { exec } from "child_process";
import { promisify } from "util";
import { IOperationResult, ExecReply } from "../types";
import { cliLogger } from "./logger";

const execAsync = promisify(exec);

/**
 * Run a shell command and return a structured result.
 */
export async function runCommand(
  cmd: string,
  expectedStatus = 0,
  timeout = 30000,
  cwd?: string
): Promise<ExecReply> {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout,
      cwd,
    });
    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (err: any) {
    return {
      success: err.code === expectedStatus,
      error: err.message,
      stdout: err.stdout?.trim(),
      stderr: err.stderr?.trim(),
      exitCode: err.code,
    };
  }
}

/**
 * Check if a systemd service is active.
 */
export async function isServiceActive(serviceName: string): Promise<boolean> {
  const result = await runCommand(
    `systemctl is-active ${serviceName}`,
    0,
    5000
  );
  return result.stdout === "active";
}

/**
 * Check if a systemd service is enabled.
 */
export async function isServiceEnabled(serviceName: string): Promise<boolean> {
  const result = await runCommand(
    `systemctl is-enabled ${serviceName}`,
    0,
    5000
  );
  return result.stdout === "enabled";
}

/**
 * Start a systemd service.
 */
export async function startService(
  serviceName: string
): Promise<IOperationResult> {
  const result = await runCommand(
    `sudo systemctl start ${serviceName}`,
    0,
    10000
  );
  if (result.success) {
    cliLogger.info(`Started service: ${serviceName}`);
    return { success: true };
  }
  cliLogger.error(
    `Failed to start service ${serviceName}: ${result.error || result.stderr}`
  );
  return {
    success: false,
    error: result.error || result.stderr || "Unknown error",
  };
}

/**
 * Stop a systemd service.
 */
export async function stopService(
  serviceName: string
): Promise<IOperationResult> {
  const result = await runCommand(
    `sudo systemctl stop ${serviceName}`,
    0,
    10000
  );
  if (result.success) {
    cliLogger.info(`Stopped service: ${serviceName}`);
    return { success: true };
  }
  cliLogger.error(
    `Failed to stop service ${serviceName}: ${result.error || result.stderr}`
  );
  return {
    success: false,
    error: result.error || result.stderr || "Unknown error",
  };
}

/**
 * Enable and start a systemd service.
 */
export async function enableService(
  serviceName: string
): Promise<IOperationResult> {
  const result = await runCommand(
    `sudo systemctl enable --now ${serviceName}`,
    0,
    10000
  );
  if (result.success) {
    cliLogger.info(`Enabled service: ${serviceName}`);
    return { success: true };
  }
  return {
    success: false,
    error: result.error || result.stderr || "Unknown error",
  };
}

/**
 * Reload systemd daemon configuration.
 */
export async function daemonReload(): Promise<IOperationResult> {
  const result = await runCommand("sudo systemctl daemon-reload", 0, 10000);
  if (result.success) {
    return { success: true };
  }
  return {
    success: false,
    error: result.error || result.stderr || "Unknown error",
  };
}

/**
 * Get the status of a systemd service.
 */
export async function getServiceStatus(
  serviceName: string
): Promise<{ active: boolean; enabled: boolean; status: string }> {
  const [activeResult, enabledResult, statusResult] = await Promise.all([
    isServiceActive(serviceName),
    isServiceEnabled(serviceName),
    runCommand(`systemctl status ${serviceName}`, undefined, 5000),
  ]);

  return {
    active: activeResult,
    enabled: enabledResult,
    status: statusResult.stdout || "unknown",
  };
}
