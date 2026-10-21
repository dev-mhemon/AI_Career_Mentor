import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const local = process.env.MENTOR_LOCAL_DIR || path.resolve(".local/foundation");
const config = JSON.parse(readFileSync(path.join(local, "frontend.json")));
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3203",
  ],
  {
    cwd: path.resolve("frontend"),
    env: { ...process.env, ...config },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
app.stdout.on("data", (b) => (output += b));
app.stderr.on("data", (b) => (output += b));
const results = [];
let completed = false;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3203/login")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, "Next production readiness");
  for (const route of ["/login", "/register", "/verify"]) {
    const r = await fetch("http://127.0.0.1:3203" + route);
    assert.equal(r.status, 200);
    assert((await r.text()).length > 100);
    results.push({ route, status: r.status });
  }
  const r = await fetch("http://127.0.0.1:3203/dashboard", {
    redirect: "manual",
  });
  assert([303, 307, 308].includes(r.status));
  assert(
    new URL(r.headers.get("location"), "http://127.0.0.1:3203").pathname ===
      "/login",
  );
  results.push({ route: "/dashboard", status: r.status, location: "/login" });
  console.log(
    "PASS: Next production startup; login/register/verify HTTP 200; dashboard redirects unauthenticated to login",
  );
  completed = true;
} finally {
  app.kill("SIGTERM");
  mkdirSync("artifacts/frontend", { recursive: true });
  writeFileSync(
    "artifacts/frontend/http.json",
    JSON.stringify(
      {
        executed_at: new Date().toISOString(),
        status: completed ? "passed" : "failed",
        checks: results,
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(local, "frontend-http.private.log"), output, {
    mode: 0o600,
  });
}
