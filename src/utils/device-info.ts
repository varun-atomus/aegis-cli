import * as os from "os";
import { IDeviceInfo } from "../types";
import { APP_VERSION } from "../types/constants";

/**
 * Get device information for the current machine.
 */
export function getDeviceInfo(): IDeviceInfo {
  return {
    username: os.userInfo().username,
    deviceName: os.hostname(),
    platform: process.platform,
    aegisVersion: APP_VERSION,
    appSource: "aegis-cli",
  };
}

/**
 * Get extended system information for compliance reports.
 */
export function getExtendedDeviceInfo() {
  return {
    ...getDeviceInfo(),
    arch: os.arch(),
    osRelease: os.release(),
    osType: os.type(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpuCount: os.cpus().length,
    uptime: os.uptime(),
  };
}
