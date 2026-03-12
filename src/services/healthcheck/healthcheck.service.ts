import * as crypto from "crypto";
import { Service } from "../base/service";
import { ShieldService } from "../shield/shield.service";
import { ConfigService } from "../config/config.service";
import {
  HealthcheckResult,
  ComplianceReport,
  ITypedOperationResult,
} from "../../types";
import { HealthcheckTests } from "../../types/constants";
import { DataCollectorClient, getDeviceInfo } from "../../utils";

/**
 * Health check service for device compliance monitoring.
 * Runs compliance tests and uploads results to Azure Log Analytics.
 *
 * Tests:
 * - testDefender: Microsoft Defender for Endpoint
 * - testDiskEncryption: LUKS/dm-crypt encryption
 * - testFipsEnabled: FIPS 140-2 mode
 * - testOsqueryStatus: osquery daemon status
 * - testShieldStatus: atomus-shield agent health
 * - testCisBenchmarks: CIS Level 1 benchmarks
 * - testIntune: Microsoft Intune installation
 */
export class HealthcheckService extends Service {
  private shieldService: ShieldService;
  private configService: ConfigService;
  private dataCollector: DataCollectorClient | null = null;
  private onboardingSent = false;

  constructor(shieldService: ShieldService, configService: ConfigService) {
    super("healthcheck");
    this.shieldService = shieldService;
    this.configService = configService;
  }

  protected async doInit(): Promise<void> {
    // Initialize data collector if config is available
    const laInfo = this.configService.getLogAnalyticsInfo();
    if (laInfo) {
      this.dataCollector = new DataCollectorClient(
        laInfo.workspaceId,
        laInfo.workspaceKey,
        this.configService.getCloudInstance()
      );
      this.dataCollector.setDeviceInfo(getDeviceInfo());
      this.logger.info("Data collector initialized for healthcheck results");
    } else {
      this.logger.warn(
        "No Log Analytics config available. Results will only be logged locally."
      );
    }
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Run all compliance tests and return a full report.
   */
  async runAllTests(): Promise<ITypedOperationResult<ComplianceReport>> {
    await this.waitForInit();

    this.logger.info("Starting compliance healthcheck...");
    const deviceInfo = getDeviceInfo();
    const creds = (this.configService as any).authService?.getStoredCredentials?.();

    const results: HealthcheckResult[] = [];
    const testFunctions = this.getPlatformTests();

    for (const test of testFunctions) {
      try {
        const result = await test.fn();
        results.push(result);
        this.logger.info(
          `${test.name}: ${result.passed ? "PASSED" : "FAILED"} - ${result.details}`
        );
      } catch (err: any) {
        results.push({
          testName: test.name,
          passed: false,
          details: `Test error: ${err.message}`,
          timestamp: new Date().toISOString(),
        });
        this.logger.error(`${test.name}: ERROR - ${err.message}`);
      }
    }

    const overallCompliant = results.every((r) => r.passed);
    const report: ComplianceReport = {
      deviceName: deviceInfo.deviceName,
      platform: deviceInfo.platform,
      email: creds?.email,
      timestamp: new Date().toISOString(),
      results,
      overallCompliant,
    };

    // Upload to Log Analytics
    await this.uploadResults(report);

    // Notify backend on full compliance (matching Mac app pattern)
    if (overallCompliant && !this.onboardingSent) {
      await this.notifyOnboardingSuccess(report);
    }

    this.logger.info(
      `Healthcheck complete: ${results.filter((r) => r.passed).length}/${results.length} passed`
    );

    return { success: true, data: report };
  }

  /**
   * Run a single test by name.
   */
  async runTest(
    testName: string
  ): Promise<ITypedOperationResult<HealthcheckResult>> {
    await this.waitForInit();

    const testMap: Record<string, () => Promise<HealthcheckResult>> = {};
    for (const t of this.getPlatformTests()) {
      testMap[t.name] = t.fn;
    }

    const testFn = testMap[testName];
    if (!testFn) {
      return {
        success: false,
        error: `Unknown test: ${testName}. Valid tests: ${Object.keys(testMap).join(", ")}`,
      };
    }

    try {
      const result = await testFn();
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ─── Platform Test Selection ──────────────────────────────────────

  private getPlatformTests(): Array<{
    name: string;
    fn: () => Promise<HealthcheckResult>;
  }> {
    const common = [
      { name: HealthcheckTests.SHIELD_STATUS, fn: () => this.testShieldStatus() },
      { name: HealthcheckTests.OSQUERY_STATUS, fn: () => this.testOsqueryStatus() },
    ];

    if (process.platform === "darwin") {
      return [
        ...common,
        { name: HealthcheckTests.FILEVAULT, fn: () => this.testFileVault() },
        { name: HealthcheckTests.DEFENDER, fn: () => this.testDefenderMac() },
        { name: HealthcheckTests.INTUNE, fn: () => this.testIntuneMac() },
      ];
    }

    // Linux tests (default)
    return [
      ...common,
      { name: HealthcheckTests.DEFENDER, fn: () => this.testDefender() },
      { name: HealthcheckTests.DISK_ENCRYPTION, fn: () => this.testDiskEncryption() },
      { name: HealthcheckTests.FIPS_ENABLED, fn: () => this.testFipsEnabled() },
      { name: HealthcheckTests.CIS_BENCHMARKS, fn: () => this.testCisBenchmarks() },
      { name: HealthcheckTests.INTUNE, fn: () => this.testIntune() },
    ];
  }

  // ─── Onboarding Notification ────────────────────────────────────

  private async notifyOnboardingSuccess(
    report: ComplianceReport
  ): Promise<void> {
    try {
      const apiResult = await this.configService.getAuthenticatedApiClient();
      if (!apiResult.success) return;

      const api = apiResult.data;
      const deviceInfo = getDeviceInfo();

      // Get osquery machine UUID via Shield
      let osqueryMachineId: string | undefined;
      try {
        const uuidResult = await this.shieldService.runCommand(
          'osqueryi --json "SELECT uuid FROM system_info"'
        );
        if (uuidResult.success && uuidResult.data?.stdout) {
          const rows = JSON.parse(uuidResult.data.stdout);
          osqueryMachineId = rows?.[0]?.uuid;
        }
      } catch {
        this.logger.warn("Could not get osquery machine UUID");
      }

      const result = await api.sendOnboardingStatus({
        email: report.email || "",
        os: deviceInfo.platform,
        onboardingStatus: "onboarded",
        deviceName: deviceInfo.deviceName,
        localUsername: deviceInfo.username,
        osqueryMachineId,
      });

      if (result.success) {
        this.onboardingSent = true;
        this.logger.info("Onboarding status sent to backend");
      } else {
        this.logger.warn(`Failed to send onboarding status: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.warn(`Onboarding notification error: ${err.message}`);
    }
  }

  // ─── macOS Test Implementations ─────────────────────────────────

  private async testFileVault(): Promise<HealthcheckResult> {
    const result = await this.shieldService.runCommand(
      "fdesetup status 2>/dev/null"
    );

    if (result.success && result.data) {
      const stdout = result.data.stdout || "";
      const isOn = stdout.includes("FileVault is On");
      return {
        testName: HealthcheckTests.FILEVAULT,
        passed: isOn,
        details: isOn
          ? "FileVault disk encryption is enabled"
          : "FileVault disk encryption is not enabled",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      testName: HealthcheckTests.FILEVAULT,
      passed: false,
      details: "Could not check FileVault status",
      timestamp: new Date().toISOString(),
    };
  }

  private async testDefenderMac(): Promise<HealthcheckResult> {
    const result = await this.shieldService.runCommand(
      "/usr/local/bin/mdatp health 2>/dev/null"
    );

    if (result.success && result.data) {
      const stdout = result.data.stdout || "";
      const isHealthy = stdout.includes("healthy") || stdout.includes("true");
      return {
        testName: HealthcheckTests.DEFENDER,
        passed: isHealthy,
        details: isHealthy
          ? "Microsoft Defender for Endpoint is healthy"
          : "Microsoft Defender for Endpoint is not healthy",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      testName: HealthcheckTests.DEFENDER,
      passed: false,
      details: "Microsoft Defender for Endpoint is not installed",
      timestamp: new Date().toISOString(),
    };
  }

  private async testIntuneMac(): Promise<HealthcheckResult> {
    // Check Company Portal + MDM profile
    const cpResult = await this.shieldService.runCommand(
      'test -d "/Applications/Company Portal.app" && echo "installed" || echo "not_installed"'
    );
    const cpInstalled =
      cpResult.success && cpResult.data?.stdout?.includes("installed");

    const profileResult = await this.shieldService.runCommand(
      "profiles list 2>/dev/null"
    );
    const mdmEnrolled =
      profileResult.success &&
      (profileResult.data?.stdout || "").includes("Microsoft.Profiles.MDM");

    const passed = !!cpInstalled;
    return {
      testName: HealthcheckTests.INTUNE,
      passed,
      details: passed
        ? `Company Portal installed${mdmEnrolled ? ", MDM enrolled" : ", MDM not enrolled"}`
        : "Company Portal is not installed",
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Linux Test Implementations ─────────────────────────────────

  private async testShieldStatus(): Promise<HealthcheckResult> {
    const isAlive = await this.shieldService.pingAgent();
    const info = isAlive ? await this.shieldService.getInfo() : null;

    return {
      testName: HealthcheckTests.SHIELD_STATUS,
      passed: isAlive,
      details: isAlive
        ? `Shield running (PID: ${info?.success ? (info.data as any)?.pid : "unknown"}, Version: ${info?.success ? (info.data as any)?.version : "unknown"})`
        : "Shield daemon is not reachable",
      timestamp: new Date().toISOString(),
    };
  }

  private async testDefender(): Promise<HealthcheckResult> {
    // Check if Microsoft Defender for Endpoint is installed and running
    const result = await this.shieldService.runCommand(
      "systemctl is-active mdatp 2>/dev/null || which mdatp 2>/dev/null"
    );

    if (result.success && result.data) {
      const stdout = result.data.stdout || "";
      const isActive = stdout.includes("active") || stdout.includes("/mdatp");
      return {
        testName: HealthcheckTests.DEFENDER,
        passed: isActive,
        details: isActive
          ? "Microsoft Defender for Endpoint is active"
          : "Microsoft Defender for Endpoint is not active",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      testName: HealthcheckTests.DEFENDER,
      passed: false,
      details: "Could not check Defender status",
      timestamp: new Date().toISOString(),
    };
  }

  private async testDiskEncryption(): Promise<HealthcheckResult> {
    // Check for LUKS/dm-crypt encryption
    const result = await this.shieldService.runCommand(
      "lsblk -o NAME,TYPE,FSTYPE | grep -i crypt || dmsetup status 2>/dev/null"
    );

    if (result.success && result.data) {
      const stdout = result.data.stdout || "";
      const isEncrypted =
        stdout.includes("crypt") || stdout.includes("LUKS");
      return {
        testName: HealthcheckTests.DISK_ENCRYPTION,
        passed: isEncrypted,
        details: isEncrypted
          ? "Disk encryption (LUKS/dm-crypt) detected"
          : "No disk encryption detected",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      testName: HealthcheckTests.DISK_ENCRYPTION,
      passed: false,
      details: "Could not check disk encryption status",
      timestamp: new Date().toISOString(),
    };
  }

  private async testFipsEnabled(): Promise<HealthcheckResult> {
    // Check FIPS 140-2 mode
    const result = await this.shieldService.runCommand(
      "cat /proc/sys/crypto/fips_enabled 2>/dev/null"
    );

    if (result.success && result.data) {
      const stdout = (result.data.stdout || "").trim();
      const isEnabled = stdout === "1";
      return {
        testName: HealthcheckTests.FIPS_ENABLED,
        passed: isEnabled,
        details: isEnabled
          ? "FIPS 140-2 mode is enabled"
          : "FIPS 140-2 mode is not enabled",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      testName: HealthcheckTests.FIPS_ENABLED,
      passed: false,
      details: "Could not check FIPS status",
      timestamp: new Date().toISOString(),
    };
  }

  private async testOsqueryStatus(): Promise<HealthcheckResult> {
    // Check if osqueryd service is running
    const result = await this.shieldService.runCommand(
      "systemctl is-active osqueryd 2>/dev/null"
    );

    if (result.success && result.data) {
      const isActive = (result.data.stdout || "").trim() === "active";
      return {
        testName: HealthcheckTests.OSQUERY_STATUS,
        passed: isActive,
        details: isActive
          ? "osquery daemon is running"
          : "osquery daemon is not running",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      testName: HealthcheckTests.OSQUERY_STATUS,
      passed: false,
      details: "Could not check osquery status",
      timestamp: new Date().toISOString(),
    };
  }

  private async testCisBenchmarks(): Promise<HealthcheckResult> {
    // Run basic CIS Level 1 checks via osquery
    const checks: Array<{ name: string; query: string; expected: string }> = [
      {
        name: "SSH root login disabled",
        query:
          "osqueryi --json \"SELECT * FROM ssh_configs WHERE key='PermitRootLogin' AND value='no'\"",
        expected: "PermitRootLogin",
      },
      {
        name: "Firewall active",
        query: "systemctl is-active ufw 2>/dev/null || systemctl is-active firewalld 2>/dev/null",
        expected: "active",
      },
      {
        name: "Password authentication",
        query:
          "osqueryi --json \"SELECT * FROM ssh_configs WHERE key='PasswordAuthentication'\"",
        expected: "PasswordAuthentication",
      },
    ];

    const passedChecks: string[] = [];
    const failedChecks: string[] = [];

    for (const check of checks) {
      try {
        const result = await this.shieldService.runCommand(check.query);
        if (
          result.success &&
          result.data?.stdout?.includes(check.expected)
        ) {
          passedChecks.push(check.name);
        } else {
          failedChecks.push(check.name);
        }
      } catch {
        failedChecks.push(check.name);
      }
    }

    const allPassed = failedChecks.length === 0;
    return {
      testName: HealthcheckTests.CIS_BENCHMARKS,
      passed: allPassed,
      details: allPassed
        ? `All CIS checks passed: ${passedChecks.join(", ")}`
        : `Failed checks: ${failedChecks.join(", ")}. Passed: ${passedChecks.join(", ") || "none"}`,
      timestamp: new Date().toISOString(),
    };
  }

  private async testIntune(): Promise<HealthcheckResult> {
    // Check if Microsoft Intune agent is installed
    const result = await this.shieldService.runCommand(
      "which intune-portal 2>/dev/null || dpkg -l | grep intune 2>/dev/null || rpm -qa | grep intune 2>/dev/null"
    );

    if (result.success && result.data) {
      const stdout = result.data.stdout || "";
      const isInstalled = stdout.length > 0;
      return {
        testName: HealthcheckTests.INTUNE,
        passed: isInstalled,
        details: isInstalled
          ? "Microsoft Intune agent is installed"
          : "Microsoft Intune agent is not installed",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      testName: HealthcheckTests.INTUNE,
      passed: false,
      details: "Could not check Intune status",
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Upload Results ───────────────────────────────────────────────

  private async uploadResults(report: ComplianceReport): Promise<void> {
    if (!this.dataCollector) {
      this.logger.warn("No data collector configured; skipping upload");
      return;
    }

    try {
      const logEntries = report.results.map((r) => ({
        id: crypto.randomUUID(),
        TestName: r.testName,
        Passed: r.passed,
        Details: r.details,
        DeviceName: report.deviceName,
        Platform: report.platform,
        Email: report.email || "",
        OverallCompliant: report.overallCompliant,
        TimeGenerated: report.timestamp,
        AppSource: "aegis-cli",
      }));

      const success = await this.dataCollector.postData(
        "AegisHealthcheck",
        logEntries,
        report.timestamp
      );

      if (success) {
        this.logger.info("Healthcheck results uploaded to Log Analytics");
      } else {
        this.logger.error("Failed to upload healthcheck results");
      }
    } catch (err: any) {
      this.logger.error(`Upload error: ${err.message}`);
    }
  }
}
