import * as fs from "fs";
import * as path from "path";
import { Directories, Files } from "../types/constants";
import { cliLogger } from "./logger";

/**
 * All directories that need to exist for the CLI to function.
 */
const REQUIRED_DIRECTORIES = [
  Directories.DATA,
  Directories.LOGS,
  Directories.OSQUERY_CONFIG,
  Directories.USER_CONFIG,
];

/**
 * Ensure all required directories exist.
 * Some directories require root access (system dirs), others are user-level.
 */
export function ensureDirectories(): void {
  for (const dir of REQUIRED_DIRECTORIES) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        cliLogger.info(`Created directory: ${dir}`);
      }
    } catch (err: any) {
      // User-level dirs should always succeed; system dirs may need sudo
      if (dir.startsWith(process.env.HOME || "~")) {
        cliLogger.error(`Failed to create directory ${dir}: ${err.message}`);
      } else {
        cliLogger.debug(
          `Cannot create system directory ${dir} (may need sudo): ${err.message}`
        );
      }
    }
  }
}

/**
 * Ensure only user-level directories exist (no sudo needed).
 */
export function ensureUserDirectories(): void {
  const userDirs = [Directories.USER_CONFIG];
  for (const dir of userDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Check if the daemon PID file exists and the process is running.
 */
export function isDaemonRunning(): { running: boolean; pid?: number } {
  try {
    if (!fs.existsSync(Files.DAEMON_PID)) {
      return { running: false };
    }
    const pid = parseInt(fs.readFileSync(Files.DAEMON_PID, "utf-8").trim(), 10);
    if (isNaN(pid)) {
      return { running: false };
    }
    // Check if process is alive
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    // Process not running, clean up stale PID file
    try {
      fs.unlinkSync(Files.DAEMON_PID);
    } catch {}
    return { running: false };
  }
}

/**
 * Write the current process PID to the PID file.
 */
export function writePidFile(): void {
  const pidDir = path.dirname(Files.DAEMON_PID);
  if (!fs.existsSync(pidDir)) {
    fs.mkdirSync(pidDir, { recursive: true });
  }
  fs.writeFileSync(Files.DAEMON_PID, process.pid.toString(), "utf-8");
}

/**
 * Remove the PID file on shutdown.
 */
export function removePidFile(): void {
  try {
    if (fs.existsSync(Files.DAEMON_PID)) {
      fs.unlinkSync(Files.DAEMON_PID);
    }
  } catch {}
}
