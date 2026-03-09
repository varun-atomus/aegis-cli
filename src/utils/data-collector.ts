import * as crypto from "crypto";
import axios from "axios";
import { MicrosoftUrls } from "../types/constants";
import { CloudInstance, IDeviceInfo } from "../types";
import { createServiceLogger } from "./logger";

const log = createServiceLogger("data-collector");

/**
 * Azure Log Analytics Data Collector client.
 * Uses SharedKey HMAC-SHA256 authentication to post data.
 */
export class DataCollectorClient {
  private readonly workspaceId: string;
  private readonly workspaceKey: string;
  private readonly baseUrl: string;
  private deviceInfo?: IDeviceInfo;

  constructor(
    workspaceId: string,
    workspaceKey: string,
    cloudInstance: CloudInstance
  ) {
    this.workspaceId = workspaceId;
    this.workspaceKey = workspaceKey;

    const domain =
      cloudInstance === "gov"
        ? MicrosoftUrls.gov.DataCollector
        : MicrosoftUrls.commercial.DataCollector;

    this.baseUrl = `https://${workspaceId}.${domain}/api/logs?api-version=2016-04-01`;
  }

  /**
   * Set device info to automatically append to all log entries.
   */
  setDeviceInfo(deviceInfo: IDeviceInfo): void {
    this.deviceInfo = deviceInfo;
  }

  /**
   * Build the HMAC-SHA256 authorization signature.
   */
  private buildSignature(
    date: string,
    contentLength: number,
    method: string,
    contentType: string,
    resource: string
  ): string {
    const stringToHash = `${method}\n${contentLength}\n${contentType}\nx-ms-date:${date}\n${resource}`;
    const bytesToHash = Buffer.from(stringToHash, "utf-8");
    const decodedKey = Buffer.from(this.workspaceKey, "base64");
    const hash = crypto
      .createHmac("sha256", decodedKey)
      .update(bytesToHash)
      .digest("base64");
    return `SharedKey ${this.workspaceId}:${hash}`;
  }

  /**
   * Post data to Azure Log Analytics.
   */
  async postData(
    logType: string,
    data: Record<string, any> | Record<string, any>[],
    timeGenerated?: string,
    addDeviceInfo = true
  ): Promise<boolean> {
    try {
      const records = Array.isArray(data) ? data : [data];

      // Append device info to each record if available
      const enrichedRecords = records.map((record) => {
        const enriched = { ...record };
        if (addDeviceInfo && this.deviceInfo) {
          enriched.deviceName = this.deviceInfo.deviceName;
          enriched.platform = this.deviceInfo.platform;
          enriched.username = this.deviceInfo.username;
          enriched.aegisVersion = this.deviceInfo.aegisVersion;
        }
        if (timeGenerated) {
          enriched.TimeGenerated = timeGenerated;
        }
        return enriched;
      });

      const body = JSON.stringify(enrichedRecords);
      const contentLength = Buffer.byteLength(body, "utf-8");
      const rfc1123Date = new Date().toUTCString();
      const contentType = "application/json";
      const resource = "/api/logs";

      const signature = this.buildSignature(
        rfc1123Date,
        contentLength,
        "POST",
        contentType,
        resource
      );

      const response = await axios.post(this.baseUrl, body, {
        headers: {
          "Content-Type": contentType,
          Authorization: signature,
          "Log-Type": logType,
          "x-ms-date": rfc1123Date,
          "time-generated-field": "TimeGenerated",
        },
        timeout: 30000,
      });

      if (response.status >= 200 && response.status < 300) {
        log.debug(`Posted ${records.length} record(s) to ${logType}`);
        return true;
      }

      log.error(
        `Data collector POST failed: ${response.status} ${response.statusText}`
      );
      return false;
    } catch (err: any) {
      log.error(`Data collector POST error: ${err.message}`);
      return false;
    }
  }
}
