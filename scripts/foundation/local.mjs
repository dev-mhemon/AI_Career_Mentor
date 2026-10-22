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
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const local = path.resolve(
  process.env.MENTOR_LOCAL_DIR || path.join(root, ".local/foundation"),
);
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
  const r = spawnSync("npm", commands[command], {
    cwd: path.join(root, isFrontend ? "frontend" : "backend"),
    env: { ...process.env, ...config, MENTOR_LOCAL_DIR: local },
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}
