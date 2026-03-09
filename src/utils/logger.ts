import * as winston from "winston";
import * as path from "path";
import * as fs from "fs";
import { Directories } from "../types/constants";

const DailyRotateFile = require("winston-daily-rotate-file");

// Ensure log directory exists
function ensureLogDir(): void {
  try {
    if (!fs.existsSync(Directories.LOGS)) {
      fs.mkdirSync(Directories.LOGS, { recursive: true });
    }
  } catch {
    // If we can't create system log dir, fall back to user dir
  }
}

function getLogDir(): string {
  try {
    fs.accessSync(Directories.LOGS, fs.constants.W_OK);
    return Directories.LOGS;
  } catch {
    const userLogDir = path.join(
      process.env.HOME || "/tmp",
      ".atomus",
      "aegis",
      "logs"
    );
    if (!fs.existsSync(userLogDir)) {
      fs.mkdirSync(userLogDir, { recursive: true });
    }
    return userLogDir;
  }
}

ensureLogDir();
const logDir = getLogDir();

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, service }) => {
    const svc = service ? `[${service}]` : "";
    return `${timestamp} [${level.toUpperCase()}] ${svc} ${message}`;
  })
);

const cliTransport = new DailyRotateFile({
  filename: path.join(logDir, "cli-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxSize: "20m",
  maxFiles: "14d",
});

const daemonTransport = new DailyRotateFile({
  filename: path.join(logDir, "daemon-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxSize: "20m",
  maxFiles: "30d",
});

export const cliLogger = winston.createLogger({
  level: process.env.ATOMUS_DEBUG ? "debug" : "info",
  format: logFormat,
  defaultMeta: { service: "cli" },
  transports: [cliTransport],
});

export const daemonLogger = winston.createLogger({
  level: process.env.ATOMUS_DEBUG ? "debug" : "info",
  format: logFormat,
  defaultMeta: { service: "daemon" },
  transports: [daemonTransport],
});

// Add console output in debug mode
if (process.env.ATOMUS_DEBUG) {
  const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: "HH:mm:ss" }),
      winston.format.printf(({ timestamp, level, message, service }) => {
        const svc = service ? `[${service}]` : "";
        return `${timestamp} ${level} ${svc} ${message}`;
      })
    ),
  });
  cliLogger.add(consoleTransport);
  daemonLogger.add(consoleTransport);
}

/**
 * Create a scoped logger for a specific service.
 */
export function createServiceLogger(serviceId: string, isDaemon = false) {
  const baseLogger = isDaemon ? daemonLogger : cliLogger;

  return {
    info: (msg: string) => baseLogger.info(msg, { service: serviceId }),
    warn: (msg: string) => baseLogger.warn(msg, { service: serviceId }),
    error: (msg: string) => baseLogger.error(msg, { service: serviceId }),
    debug: (msg: string) => baseLogger.debug(msg, { service: serviceId }),
    critical: (msg: string) =>
      baseLogger.error(`[CRITICAL] ${msg}`, { service: serviceId }),
  };
}
