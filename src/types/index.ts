export interface ISuccessOperationResult {
  success: true;
}

export interface IErrorOperationResult {
  success: false;
  error: string;
}

export type IOperationResult = ISuccessOperationResult | IErrorOperationResult;

export interface ISuccessTypedOperationResult<T> extends ISuccessOperationResult {
  data: T;
}

export type ITypedOperationResult<T> =
  | ISuccessTypedOperationResult<T>
  | IErrorOperationResult;

export type IShieldOperationResult<T = null> =
  | ISuccessTypedOperationResult<T>
  | (IErrorOperationResult & { errorCode?: number });


export type ServiceState =
  | "unknown"
  | "initializing"
  | "configuring"
  | "error"
  | "ready"
  | "not-available";

export type ServiceId =
  | "atomus-shield"
  | "auth-provider"
  | "aegis-config"
  | "healthcheck";

// ─── Device Types ───────────────────────────────────────────────────────────

export interface IDeviceInfo {
  username: string;
  deviceName: string;
  platform: NodeJS.Platform;
  aegisVersion: string;
}

// ─── Auth Types ─────────────────────────────────────────────────────────────

export type CloudInstance = "commercial" | "gov";

export interface AuthCredentials {
  accessToken: string;
  email: string;
  tenantId: string;
  cloudInstance: CloudInstance;
  expiresOn?: Date;
}

export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  email: string;
  tenantId: string;
  cloudInstance: CloudInstance;
  expiresOn?: string;
  homeAccountId?: string;
}

// ─── Config Types ───────────────────────────────────────────────────────────

export interface AegisConfig {
  [key: string]: any;
}

export interface LAWorkspaceInfo {
  workspaceId: string;
  workspaceKey: string;
  baseUrl: string;
}

export interface ShieldContext {
  email?: string;
  externalApiUrl?: string;
  backupExternalApiUrl?: string;
  deviceInfo: IDeviceInfo;
  logDir: string;
  laWorkspaceInfo: LAWorkspaceInfo;
}

// ─── External API Types ─────────────────────────────────────────────────────

export interface SuccessAegisResponse<T> {
  success: true;
  code: number;
  data: T;
  isAegisResponse: true;
}

export interface ErrorAegisResponse<T = undefined> {
  success: false;
  code: number;
  error: string;
  data: T;
  isAegisResponse: true;
}

export type AegisResponse<T> = SuccessAegisResponse<T> | ErrorAegisResponse<T>;

// ─── Healthcheck Types ──────────────────────────────────────────────────────

export interface HealthcheckResult {
  testName: string;
  passed: boolean;
  details: string;
  timestamp: string;
}

export interface ComplianceReport {
  deviceName: string;
  platform: string;
  email?: string;
  timestamp: string;
  results: HealthcheckResult[];
  overallCompliant: boolean;
}

// ─── Command Execution Types ────────────────────────────────────────────────

export interface ExecReply {
  success: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

// ─── Log Types ──────────────────────────────────────────────────────────────

export type LogLevel = "critical" | "error" | "warning" | "info" | "debug";
export type LogFunc = (level: LogLevel, message: string) => void;

// ─── Daemon Types ───────────────────────────────────────────────────────────

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
  lastHealthcheck?: string;
  nextHealthcheck?: string;
}
