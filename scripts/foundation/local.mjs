/** Dedicated disposable local stack. Never prints status credentials. */
import { execFileSync, spawnSync } from "./process.mjs";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  cpSync,
  existsSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const local = path.resolve(
  process.env.MENTOR_LOCAL_DIR || path.join(root, ".local/foundation"),
);
export const parseEnvContent = (content) => {
  if (!content || typeof content !== "string") return {};
  if (typeof parseEnv === "function") {
    return parseEnv(content);
  }
  const parsed = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      const q = val[0];
      val = val.slice(1, -1);
      if (q === '"') {
        val = val
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    } else {
      const commentIdx = val.indexOf("#");
      if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
    }
    parsed[key] = val;
  }
  return parsed;
};

export const parseEnvFile = (filePath) => {
  if (!existsSync(filePath)) return {};
  return parseEnvContent(readFileSync(filePath, "utf8"));
};

export function buildBackendLaunchEnv(
  baseConfig = {},
  dotEnvSource = "",
  procEnv = process.env,
  localDir = local,
) {
  const backendEnv =
    typeof dotEnvSource === "string"
      ? parseEnvContent(dotEnvSource)
      : (dotEnvSource || {});

  const textBeeOverlay = Object.fromEntries(
    [
      "TEXTBEE_API_KEY",
      "TEXTBEE_DEVICE_ID",
      "TEXTBEE_BASE_URL",
      "TEXTBEE_TIMEOUT_MS",
    ]
      .map((k) => [k, procEnv[k] || backendEnv[k] || ""])
      .filter(([, v]) => Boolean(v)),
  );

  return {
    ...procEnv,
    ...backendEnv,
    ...baseConfig,
    ...textBeeOverlay,
    ...(localDir ? { MENTOR_LOCAL_DIR: localDir } : {}),
  };
}
const cli = process.env.SUPABASE_BIN || "supabase";
const env = {
  ...process.env,
  SUPABASE_HOME: process.env.SUPABASE_HOME || path.join(local, "cli-state"),
  SUPABASE_INTERNAL_IMAGE_REGISTRY:
    process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY || "docker.io",
};
const run = (args, privateLog) => {
  const r = spawnSync(cli, [...args, "--workdir", local], {
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (privateLog)
    writeFileSync(
      path.join(local, privateLog),
      (r.stdout || "") + (r.stderr || ""),
      { mode: 0o600 },
    );
  if (r.status !== 0)
    throw Error(
      `Supabase ${args[0]} failed (${r.status}); inspect private ${privateLog || "CLI output"} locally`,
    );
  return r.stdout;
};

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  mkdirSync(local, { recursive: true, mode: 0o700 });
chmodSync(local, 0o700);
if (local === root || local.includes("reviewed-baseline"))
  throw Error("Use a dedicated disposable directory");
const command = process.argv[2] || "start";
if (command === "start") {
  execFileSync(
    "python3",
    [path.join(root, "scripts/foundation/verify-baseline.py")],
    { stdio: "inherit" },
  );
  mkdirSync(path.join(local, "supabase"), { recursive: true });
  const existingConfig = path.join(local, "supabase/config.toml");
  if (
    existsSync(existingConfig) &&
    !readFileSync(existingConfig, "utf8").includes(
      'project_id = "ai-career-mentor-foundation"',
    )
  )
    throw Error("Refusing to overwrite another local project");
  for (const f of readdirSync(path.join(root, "supabase/migrations"))) {
    const target = path.join(local, "supabase/migrations", f);
    if (
      existsSync(target) &&
      !readFileSync(target).equals(
        readFileSync(path.join(root, "supabase/migrations", f)),
      )
    )
      throw Error(
        "Existing migration checksum differs; preserve history and use a reviewed new version",
      );
  }

  cpSync(
    path.join(root, "supabase/config.toml"),
    path.join(local, "supabase/config.toml"),
  );
  for (const folder of ["migrations", "tests", "rollbacks"])
    cpSync(
      path.join(root, "supabase", folder),
      path.join(local, "supabase", folder),
      { recursive: true },
    );
  const signing = path.join(local, "supabase/signing_keys.json");
  if (!existsSync(signing)) {
    const configPath = path.join(local, "supabase/config.toml");
    const configText = readFileSync(configPath, "utf8");
    writeFileSync(
      configPath,
      configText.replace(/^signing_keys_path = .*$/m, ""),
    );
    const key = JSON.parse(
      run(
        ["gen", "signing-key", "--algorithm", "ES256"],
        "key-generation.private.log",
      ),
    );
    writeFileSync(signing, JSON.stringify(Array.isArray(key) ? key : [key]), {
      mode: 0o600,
    });
    writeFileSync(configPath, configText);
  }
  run(
    [
      "start",
      "--exclude",
      "realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    ],
    "start.private.log",
  );
  const status = JSON.parse(
    run(["status", "--output", "json"], "status.private.log"),
  );
  writeFileSync(path.join(local, "status.json"), JSON.stringify(status), {
    mode: 0o600,
  });
  const db = new URL(status.DB_URL);
  const backendEnv = parseEnvFile(path.join(root, "backend/.env"));
  const backend = {
    PORT: "3200",
    SUPABASE_URL: status.API_URL,
    SUPABASE_JWKS_URL: status.API_URL + "/auth/v1/.well-known/jwks.json",
    SUPABASE_ANON_KEY: status.ANON_KEY,
    DB_HOST: db.hostname,
    DB_PORT: db.port,
    DB_USER: decodeURIComponent(db.username),
    DB_PASSWORD: decodeURIComponent(db.password),
    DB_NAME: db.pathname.slice(1),
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    AUTH_REDIS_URL:
      process.env.AUTH_REDIS_URL || backendEnv.AUTH_REDIS_URL || "redis://127.0.0.1:56379",
    AUTH_HMAC_SECRET:
      process.env.AUTH_HMAC_SECRET || backendEnv.AUTH_HMAC_SECRET || "01234567890123456789012345678901",
    AUTH_OTP_HMAC_SECRET:
      process.env.AUTH_OTP_HMAC_SECRET || backendEnv.AUTH_OTP_HMAC_SECRET || "01234567890123456789012345678901",
    MAILPIT_URL:
      process.env.MAILPIT_URL || status.MAILPIT_URL || status.INBUCKET_URL || "http://127.0.0.1:56324",
    PROVIDER_CLEANUP_ENCRYPTION_KEY:
      process.env.PROVIDER_CLEANUP_ENCRYPTION_KEY || backendEnv.PROVIDER_CLEANUP_ENCRYPTION_KEY || "01234567890123456789012345678901",
    DELETION_RECEIPT_SECRET:
      process.env.DELETION_RECEIPT_SECRET || backendEnv.DELETION_RECEIPT_SECRET || "01234567890123456789012345678901",
    TEXTBEE_API_KEY: process.env.TEXTBEE_API_KEY || backendEnv.TEXTBEE_API_KEY || "",
    TEXTBEE_DEVICE_ID: process.env.TEXTBEE_DEVICE_ID || backendEnv.TEXTBEE_DEVICE_ID || "",
    TEXTBEE_BASE_URL: process.env.TEXTBEE_BASE_URL || backendEnv.TEXTBEE_BASE_URL || "https://api.textbee.dev/api/v1",
    TEXTBEE_TIMEOUT_MS: process.env.TEXTBEE_TIMEOUT_MS || backendEnv.TEXTBEE_TIMEOUT_MS || "10000",
  };
  const frontend = {
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    NEXT_PUBLIC_API_URL: "http://127.0.0.1:3200/api/v1",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3201",
  };
  writeFileSync(path.join(local, "backend.json"), JSON.stringify(backend), {
    mode: 0o600,
  });
  writeFileSync(path.join(local, "frontend.json"), JSON.stringify(frontend), {
    mode: 0o600,
  });
  for (const endpoint of [
    "/auth/v1/health",
    "/auth/v1/.well-known/jwks.json",
    "/rest/v1/",
  ]) {
    let ready = false;
    for (let n = 0; n < 30; n++) {
      try {
        const r = await fetch(status.API_URL + endpoint, {
          headers: { apikey: status.ANON_KEY },
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) throw Error("Readiness failed: " + endpoint);
  }
  console.log(
    "PASS: isolated Supabase database/Auth/JWKS/REST ready; private runtime configuration saved",
  );
} else if (command === "stop") run(["stop"], "stop.private.log");
else {
  const isFrontend = command.startsWith("frontend");
  const config = JSON.parse(
    readFileSync(
      path.join(local, isFrontend ? "frontend.json" : "backend.json"),
    ),
  );
  const commands = {
    backend: ["run", "start:prod"],
    "backend-dev": ["run", "start:dev"],
    "backend-e2e": ["run", "test:e2e"],
    "frontend-build": ["run", "build"],
    frontend: [
      "run",
      "start",
      "--",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3201",
    ],
  };
  if (!commands[command]) throw Error("Unknown command");
  const backendEnv = !isFrontend
    ? parseEnvFile(path.join(root, "backend/.env"))
    : {};
  const launchEnv = !isFrontend
    ? buildBackendLaunchEnv(config, backendEnv, process.env, local)
    : {
        ...process.env,
        ...config,
        MENTOR_LOCAL_DIR: local,
      };
  const r = spawnSync("npm", commands[command], {
    cwd: path.join(root, isFrontend ? "frontend" : "backend"),
    env: launchEnv,
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}
}
