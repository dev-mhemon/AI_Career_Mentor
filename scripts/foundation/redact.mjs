import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
export function redact(text) {
  const statusPath = path.join(
    process.env.MENTOR_LOCAL_DIR || path.resolve(".local/foundation"),
    "status.json",
  );
  if (existsSync(statusPath)) {
    for (const [name, value] of Object.entries(
      JSON.parse(readFileSync(statusPath)),
    )) {
      if (
        (name.endsWith("_KEY") ||
          name.includes("SECRET") ||
          name === "DB_URL") &&
        typeof value === "string" &&
        value.length > 15
      )
        text = text.replaceAll(value, "[REDACTED]");
    }
  }
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[JWT REDACTED]")
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[SECRET KEY REDACTED]");
}
