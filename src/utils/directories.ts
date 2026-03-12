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
 * Resolve the PID file path:
 * - Use system path when writable (systemd/root mode)
 * - Fall back to user path for local non-root daemon mode
 */
function getDaemonPidFilePath(): string {
  const systemPidPath = Files.DAEMON_PID;
  const systemPidDir = path.dirname(systemPidPath);

  try {
    fs.accessSync(systemPidDir, fs.constants.W_OK);
    return systemPidPath;
  } catch {
    const userRunDir = path.join(Directories.USER_CONFIG, "run");
    if (!fs.existsSync(userRunDir)) {
      fs.mkdirSync(userRunDir, { recursive: true });
    }
    return path.join(userRunDir, "aegis-cli.pid");
  }
}

/**
 * Check if the daemon PID file exists and the process is running.
 */
export function isDaemonRunning(): { running: boolean; pid?: number } {
  const pidFile = getDaemonPidFilePath();
  try {
    if (!fs.existsSync(pidFile)) {
      return { running: false };
    }
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    if (isNaN(pid)) {
      return { running: false };
    }
    // Check if process is alive
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    // Process not running, clean up stale PID file
    try {
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }
    } catch {}
    return { running: false };
  }
}

/**
 * Write the current process PID to the PID file.
 */
export function writePidFile(): void {
  const pidFile = getDaemonPidFilePath();
  const pidDir = path.dirname(pidFile);
  if (!fs.existsSync(pidDir)) {
    fs.mkdirSync(pidDir, { recursive: true });
  }
  fs.writeFileSync(pidFile, process.pid.toString(), "utf-8");
}

/**
 * Remove the PID file on shutdown.
 */
export function removePidFile(): void {
  const pidFile = getDaemonPidFilePath();
  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch {}
}
