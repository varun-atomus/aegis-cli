import * as msal from "@azure/msal-node";
import * as fs from "fs";
import * as path from "path";
import { Service } from "../base/service";
import {
  AuthCredentials,
  StoredCredentials,
  CloudInstance,
  ITypedOperationResult,
} from "../../types";
import {
  MsalConfigs,
  MsalTokenScopes,
  Directories,
  Files,
  EnvVars,
} from "../../types/constants";
import { ensureUserDirectories } from "../../utils/directories";

/**
 * Authentication service using MSAL Device Code Flow.
 * Designed for headless Linux servers without a GUI.
 *
 * Flow:
 * 1. User runs `aegis auth login`
 * 2. CLI displays a device code and URL
 * 3. User opens URL in a browser (on any device) and enters the code
 * 4. CLI receives tokens and stores them locally
 *
 * Alternatively, set AEGIS_TOKEN env var to bypass device code flow entirely.
 */
export class AuthService extends Service {
  private commercialApp: msal.PublicClientApplication;
  private govApp: msal.PublicClientApplication;
  private credentials: StoredCredentials | null = null;

  constructor() {
    super("auth-provider");

    this.commercialApp = new msal.PublicClientApplication({
      auth: {
        clientId: MsalConfigs.COMMERCIAL.auth.clientId,
        authority: MsalConfigs.COMMERCIAL.auth.authority,
      },
    });

    this.govApp = new msal.PublicClientApplication({
      auth: {
        clientId: MsalConfigs.GOV.auth.clientId,
        authority: MsalConfigs.GOV.auth.authority,
      },
    });
  }

  protected async doInit(): Promise<void> {
    ensureUserDirectories();
    this.loadStoredCredentials();
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Check if AEGIS_TOKEN env var is set.
   */
  hasEnvToken(): boolean {
    return !!process.env[EnvVars.TOKEN];
  }

  /**
   * Build credentials from AEGIS_TOKEN env var.
   * Decodes JWT claims to extract email, tenantId, and expiration.
   */
  getEnvTokenCredentials(): StoredCredentials | null {
    const token = process.env[EnvVars.TOKEN]?.trim();
    if (!token) return null;

    const claims = this.decodeJwtClaims(token);
    const cloudInstance: CloudInstance =
      (process.env[EnvVars.CLOUD] as CloudInstance) || "commercial";

    return {
      accessToken: token,
      email: claims?.preferred_username || claims?.email || claims?.upn || "",
      tenantId: claims?.tid || "",
      cloudInstance,
      expiresOn: claims?.exp
        ? new Date(claims.exp * 1000).toISOString()
        : undefined,
    };
  }

  /**
   * Login using MSAL device code flow.
   * Returns the device code message that the user needs to act on.
   */
  async loginWithDeviceCode(
    cloudInstance: CloudInstance,
    onDeviceCode: (message: string, userCode: string, verificationUri: string) => void
  ): Promise<ITypedOperationResult<AuthCredentials>> {
    await this.waitForInit();

    const app =
      cloudInstance === "gov" ? this.govApp : this.commercialApp;

    const scopes = [
      MsalTokenScopes.ATOMUS_AEGIS_API,
      MsalTokenScopes.OFFLINE_ACCESS,
    ];

    try {
      const result = await app.acquireTokenByDeviceCode({
        deviceCodeCallback: (response) => {
          onDeviceCode(
            response.message,
            response.userCode,
            response.verificationUri
          );
        },
        scopes,
      });

      if (!result) {
        return { success: false, error: "No authentication result received" };
      }

      const email = this.extractEmail(result);
      const tenantId = result.tenantId || "";

      const credentials: AuthCredentials = {
        accessToken: result.accessToken,
        email,
        tenantId,
        cloudInstance,
        expiresOn: result.expiresOn || undefined,
      };

      // Store credentials
      this.storeCredentials({
        accessToken: result.accessToken,
        email,
        tenantId,
        cloudInstance,
        expiresOn: result.expiresOn?.toISOString(),
        homeAccountId: result.account?.homeAccountId,
      });

      this.logger.info(`Authenticated as ${email} (tenant: ${tenantId})`);

      return { success: true, data: credentials };
    } catch (err: any) {
      this.logger.error(`Device code login failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Try to acquire a token silently using cached credentials.
   * If AEGIS_TOKEN env var is set, returns it directly (no MSAL refresh).
   */
  async acquireTokenSilent(): Promise<ITypedOperationResult<AuthCredentials>> {
    await this.waitForInit();

    // Env var token takes priority — skip MSAL entirely
    const envCreds = this.getEnvTokenCredentials();
    if (envCreds) {
      this.logger.debug("Using token from AEGIS_TOKEN env var");
      return {
        success: true,
        data: {
          accessToken: envCreds.accessToken,
          email: envCreds.email,
          tenantId: envCreds.tenantId,
          cloudInstance: envCreds.cloudInstance,
          expiresOn: envCreds.expiresOn ? new Date(envCreds.expiresOn) : undefined,
        },
      };
    }

    if (!this.credentials) {
      return { success: false, error: "No stored credentials found. Run 'aegis auth login' first." };
    }

    const { cloudInstance, homeAccountId } = this.credentials;
    const app = cloudInstance === "gov" ? this.govApp : this.commercialApp;

    try {
      // Try to get cached account
      const accounts = await app.getTokenCache().getAllAccounts();
      const account = homeAccountId
        ? accounts.find((a) => a.homeAccountId === homeAccountId)
        : accounts[0];

      if (!account) {
        return {
          success: false,
          error: "No cached account found. Run 'aegis auth login' first.",
        };
      }

      const result = await app.acquireTokenSilent({
        account,
        scopes: [
          MsalTokenScopes.ATOMUS_AEGIS_API,
          MsalTokenScopes.OFFLINE_ACCESS,
        ],
      });

      if (!result) {
        return { success: false, error: "Silent token acquisition returned no result" };
      }

      const credentials: AuthCredentials = {
        accessToken: result.accessToken,
        email: this.credentials.email,
        tenantId: this.credentials.tenantId,
        cloudInstance,
        expiresOn: result.expiresOn || undefined,
      };

      // Update stored token
      this.storeCredentials({
        ...this.credentials,
        accessToken: result.accessToken,
        expiresOn: result.expiresOn?.toISOString(),
      });

      return { success: true, data: credentials };
    } catch (err: any) {
      this.logger.warn(`Silent token acquisition failed: ${err.message}`);
      return {
        success: false,
        error: `Token refresh failed: ${err.message}. Run 'aegis auth login' to re-authenticate.`,
      };
    }
  }

  /**
   * Get currently stored credentials (may be expired).
   * Returns env var credentials if AEGIS_TOKEN is set.
   */
  getStoredCredentials(): StoredCredentials | null {
    return this.getEnvTokenCredentials() || this.credentials;
  }

  /**
   * Check if the user is currently authenticated.
   * Returns true if AEGIS_TOKEN env var is set.
   */
  isAuthenticated(): boolean {
    if (this.hasEnvToken()) return true;
    if (!this.credentials) return false;
    if (!this.credentials.expiresOn) return true;
    return new Date(this.credentials.expiresOn) > new Date();
  }

  /**
   * Clear stored credentials (logout).
   */
  logout(): void {
    this.credentials = null;
    try {
      if (fs.existsSync(Files.CREDENTIALS)) {
        fs.unlinkSync(Files.CREDENTIALS);
      }
      this.logger.info("Logged out successfully");
    } catch (err: any) {
      this.logger.error(`Failed to clear credentials: ${err.message}`);
    }
  }

  /**
   * Detect cloud instance from email domain.
   */
  detectCloudInstance(email: string): CloudInstance {
    // Government cloud domains typically use .us or specific gov patterns
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return "commercial";

    // Common GovCloud indicators
    if (
      domain.endsWith(".gov") ||
      domain.endsWith(".mil") ||
      domain.includes("gov")
    ) {
      return "gov";
    }
    return "commercial";
  }

  // ─── Private Methods ──────────────────────────────────────────────

  private decodeJwtClaims(token: string): Record<string, any> | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  private extractEmail(result: msal.AuthenticationResult): string {
    const claims = result.idTokenClaims as any;
    return (
      claims?.preferred_username ||
      claims?.email ||
      claims?.upn ||
      result.account?.username ||
      ""
    );
  }

  private loadStoredCredentials(): void {
    try {
      if (fs.existsSync(Files.CREDENTIALS)) {
        const raw = fs.readFileSync(Files.CREDENTIALS, "utf-8");
        this.credentials = JSON.parse(raw);
        this.logger.debug(
          `Loaded stored credentials for ${this.credentials?.email}`
        );
      }
    } catch (err: any) {
      this.logger.warn(`Failed to load stored credentials: ${err.message}`);
      this.credentials = null;
    }
  }

  private storeCredentials(creds: StoredCredentials): void {
    this.credentials = creds;
    try {
      const dir = path.dirname(Files.CREDENTIALS);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(Files.CREDENTIALS, JSON.stringify(creds, null, 2), {
        mode: 0o600, // Owner read/write only
      });
    } catch (err: any) {
      this.logger.error(`Failed to store credentials: ${err.message}`);
    }
  }
}
