import dotenv from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

/** Load .env from monorepo root (works whether cwd is repo root or apps/api). */
export function loadEnv() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env"),
    resolve(__dirname, "../../../.env"), // apps/api/src → repo root
    resolve(__dirname, "../../../../.env"), // apps/api/src/lib → repo root
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      dotenv.config({ path });
    }
  }
}

loadEnv();
