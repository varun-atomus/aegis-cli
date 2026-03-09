import * as fs from "fs";
import * as path from "path";

/**
 * Simple JSON key-value store persisted to disk.
 * Ported from Electron app's KVStore pattern.
 */
export class KVStore {
  private readonly filePath: string;
  private data: Record<string, any>;

  constructor(filePath: string, defaults: Record<string, any> = {}) {
    this.filePath = filePath;
    this.data = this.load(defaults);
  }

  private load(defaults: Record<string, any>): Record<string, any> {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        return { ...defaults, ...JSON.parse(raw) };
      }
    } catch {
      // Corrupted file; start fresh
    }
    return { ...defaults };
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.data, null, 2),
        "utf-8"
      );
    } catch (err: any) {
      console.error(`KVStore: Failed to write ${this.filePath}: ${err.message}`);
    }
  }

  get<T = any>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  set(key: string, value: any): void {
    this.data[key] = value;
    this.persist();
  }

  delete(key: string): void {
    delete this.data[key];
    this.persist();
  }

  getAll(): Record<string, any> {
    return { ...this.data };
  }

  overwrite(data: Record<string, any>): void {
    this.data = { ...data };
    this.persist();
  }

  has(key: string): boolean {
    return key in this.data;
  }
}
