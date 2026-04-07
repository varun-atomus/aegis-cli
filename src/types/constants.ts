// ─── Application Constants ──────────────────────────────────────────────────

export const APP_NAME = "aegis-cli";
export const APP_VERSION = "1.0.0";

// ─── Environment Variables ──────────────────────────────────────────────────

export const EnvVars = {
  /** Pre-obtained bearer token — bypasses device code flow */
  TOKEN: "AEGIS_TOKEN",
  /** Cloud instance override: "commercial" or "gov" */
  CLOUD: "AEGIS_CLOUD",
  /** Set "true" to skip automatic Shield download/install */
  SKIP_SHIELD_INSTALL: "AEGIS_SKIP_SHIELD_INSTALL",
  /** Enable debug logging */
  DEBUG: "ATOMUS_DEBUG",
} as const;

// ─── Dev Environment Defaults (matching Mac app config.json) ────────────────

export const DevDefaults = {
  EXTERNAL_API_URL: "https://api-dev.atomuscyber.us/external/app",
  EXTERNAL_API_BACKUP_URL: "https://api-dev.atomuscybersecurity.us/external/app",
  UPLOAD_LOGS_API_KEY: "kq91kA9R5Akr92O0aofpeialag193zqw",
  CHANNEL: "dev",
  SUPPORT_REQUEST_KEY:
    "42a64a1a17722dd512e800219a58bfbb9c0ce67812aae1ceec2c9e2e4b9031ec",
  SOCKET_URL: "https://connect-dev.atomuscyber.us",
} as const;

// ─── Directory Paths ────────────────────────────────────────────────────────

export const Directories = {
  /** CLI binary location */
  BIN: "/usr/local/bin",
  /** Runtime data (config cache, osquery) */
  DATA: "/var/lib/aegis-cli",
  /** Log files */
  LOGS: "/var/log/aegis-cli",
  /** Shield binary and data */
  SHIELD: "/opt/atomus-shield",
  /** User-level config and credentials */
  USER_CONFIG: `${process.env.HOME}/.atomus/aegis`,
  /** PID file for daemon */
  PID_FILE: "/var/run/aegis-cli.pid",
  /** Osquery config */
  OSQUERY_CONFIG: "/var/lib/aegis-cli/osquery",
} as const;

export const Files = {
  CREDENTIALS: `${process.env.HOME}/.atomus/aegis/credentials`,
  USER_CONFIG: `${process.env.HOME}/.atomus/aegis/config.json`,
  CONFIG_CACHE: "/var/lib/aegis-cli/config-cache.json",
  CLI_LOG: "/var/log/aegis-cli/cli.log",
  DAEMON_LOG: "/var/log/aegis-cli/daemon.log",
  SHIELD_LOG: "/opt/atomus-shield/logs/shield.log",
  DAEMON_PID: "/var/run/aegis-cli.pid",
  DAEMON_SOCKET: "/var/run/aegis-cli.sock",
} as const;


export const MicrosoftCloudInstances = {
  COMMERCIAL: "commercial",
  GOV: "gov",
  UNSUPPORTED: "unsupported",
} as const;

export const MsalConfigs = {
  COMMERCIAL: {
    auth: {
      clientId: "aa3c215f-a451-4241-a5c5-35566194cc93",
      authority: "https://login.microsoftonline.com/organizations",
    },
  },
  GOV: {
    auth: {
      clientId: "cdb93d6d-e578-4db4-aae1-713b77e7388d",
      authority: "https://login.microsoftonline.us/organizations",
    },
  },
} as const;

export const MsalTokenScopes = {
  DEFAULT: ".default",
  OFFLINE_ACCESS: "offline_access",
  ATOMUS_AEGIS_API: "api://atomus-aegis-api/.default",
} as const;

// ─── Microsoft URLs ─────────────────────────────────────────────────────────

export const MicrosoftUrls = {
  commercial: {
    CloudInstanceUrl: "microsoftonline.com",
    DataCollector: "ods.opinsights.azure.com",
  },
  gov: {
    CloudInstanceUrl: "microsoftonline.us",
    DataCollector: "ods.opinsights.azure.us",
  },
} as const;

// ─── Shield Configuration ───────────────────────────────────────────────────

export const ShieldConfig = {
  BASE_URL: "http://127.0.0.1:7238",
  ROUTES: {
    PING: "/ping",
    INIT: "/shield-context/init",
    UPDATER_INFO: "/updater/info",
    INSTALL_UPDATE: "/updater/install",
    RUN_COMMAND: "/cmd/run",
  },
} as const;

// ─── External API ───────────────────────────────────────────────────────────

export const ExternalApiConfig = {
  DEV_BASE_URL: "https://api-dev.atomuscyber.us/external/app",
  PROD_BASE_URL: "https://api.atomuscyber.com/external/app",
  ROUTES: {
    APP_CONFIG: "/common/app-config",
    GLOBAL_CONFIG: "/common/app-config/global",
    ONBOARDING_STATUS: "/common/devices/onboarding-status",
    DEVICE_INTEGRATION_IDS: "/common/devices/integration-ids",
    UPDATE_LOGS: "/common/update-logs",
    UPLOAD_LOGS: "/common/logs/upload",
    COMPANIES: "/common/companies",
    SERVICE_LOG_ALERTS: "/common/alerts/service-logs",
    BACKUP_PREFERENCES: "/common/backup/preferences",
    VPN_PREFERENCES: "/common/vpn/preferences",
    DEFENDER_ONBOARD_JSON: "/linux/defender/defenderOnboardJson",
    DISABLED_FEATURES: "/common/disabled-features/is-disabled",
  },
} as const;

// ─── Shield Install Configuration ───────────────────────────────────────────

export const ShieldInstallConfig = {
  /** Azure Blob Storage container names per platform */
  CONTAINER: {
    darwin: "atomus-shield-darwin",
    linux: "atomus-shield-linux",
  },
  /** Binary name (same for all platforms) */
  BINARY_NAME: "atomus-shield",
  /** Platform install paths */
  DARWIN: {
    AGENT_DIR: "/Library/Application Support/com.atomuscyber.shield",
    PLIST_FILE: "com.atomuscyber.shield.plist",
    LAUNCH_DAEMON_DIR: "/Library/LaunchDaemons",
  },
  LINUX: {
    AGENT_DIR: "/opt/atomus-shield",
    SERVICE_FILE: "atomus-shield.service",
    SERVICE_DIR: "/etc/systemd/system",
  },
  /** Global config key for Azure storage connection string */
  STORAGE_CONNECTION_STRING_KEY: "privateStorageConnectionString",
  /** Temp download directory */
  TMP_DIR: "/tmp/aegis-shield-install",
} as const;

// ─── Osquery Install Configuration ──────────────────────────────────────────

export const OsqueryInstallConfig = {
  /** Azure Blob Storage container names for osquery resources */
  CONTAINERS: {
    configs: "osquery-configs-linux",
    packs: "osquery-packs-linux",
    crossPlatformPacks: "osquery-packs-609",
    queries: "osquery-queries",
  },
  /** Local install paths */
  INSTALL_DIR: "/opt/osquery",
  CONFIG_DIR: "/var/lib/aegis-cli/osquery",
  PACKS_DIR: "/var/lib/aegis-cli/osquery/packs",
  DB_DIR: "/var/lib/aegis-cli/osquery/db",
  LOG_DIR: "/var/log/aegis-cli/osquery",
  PID_FILE: "/var/lib/aegis-cli/osquery/osqueryd.pidfile",
  CONFIG_FILE: "osquery.conf",
  /** Temp download directory */
  TMP_DIR: "/tmp/aegis-osquery-install",
} as const;

// ─── Aegis Config Keys ─────────────────────────────────────────────────────

export const AegisConfigKeys = {
  ARC: "AzureConnectInfo",
  BACKUP: "BackupConfig",
  LOG_ANALYTICS: "LogAnalyticsInfo",
  REG_KEYS: "RegistryKeys",
  SEC_POL: "SecPol",
  UPDATE_URL: "UpdateUrl",
  VPN: "VPNConfig",
} as const;

export const AppConfigKeys = {
  SOCKET_URL: "aegisSocketUrl",
  EXTERNAL_API_URL: "externalApiUrl",
  EXTERNAL_API_BACKUP_URL: "externalApiBackupUrl",
  UPLOAD_LOGS_API_KEY: "uploadLogsApiKey",
  CHANNEL: "channel",
  SUPPORT_REQUEST_KEY: "supportRequestKey",
} as const;


export const HealthcheckTests = {
  DEFENDER: "testDefender",
  DISK_ENCRYPTION: "testDiskEncryption",
  FIPS_ENABLED: "testFipsEnabled",
  OSQUERY_STATUS: "testOsqueryStatus",
  SHIELD_STATUS: "testShieldStatus",
  CIS_BENCHMARKS: "testCisBenchmarks",
  INTUNE: "testIntune",
  /** macOS-specific: FileVault disk encryption */
  FILEVAULT: "testFileVault",
} as const;


/** Run healthcheck daily at 2 PM */
export const HC_CRON = "0 14 * * *";


export const Duration = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
} as const;

// ─── Shield Error Codes ─────────────────────────────────────────────────────

export const ErrorCodes = {
  Global: {
    ERR_BIND_JSON: 1001,
    ERR_NOT_INITIALIZED: 1002,
  },
} as const;
