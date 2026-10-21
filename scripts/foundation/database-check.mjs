/** Destructive lifecycle checks are restricted to this dedicated disposable project. */
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const local = path.resolve(
  process.env.MENTOR_LOCAL_DIR || path.join(root, ".local/foundation"),
);
if (process.argv[2] !== "--disposable")
  throw Error("Explicit --disposable acknowledgement required");
const config = readFileSync(path.join(local, "supabase/config.toml"), "utf8");
if (!config.startsWith("#") && !config.includes("project_id"))
  throw Error("Missing local configuration");
if (!config.includes('project_id = "ai-career-mentor-foundation"'))
  throw Error("Refusing non-foundation project");
const status = JSON.parse(readFileSync(path.join(local, "status.json")));
if (
  new URL(status.DB_URL).port !== "56322" ||
  !["127.0.0.1", "localhost"].includes(new URL(status.DB_URL).hostname)
)
  throw Error("Refusing non-local DB");
const dir = path.resolve(
  process.env.FOUNDATION_ARTIFACTS ||
    path.join(
      root,
      "artifacts/database",
      new Date().toISOString().replaceAll(":", "-"),
    ),
);
mkdirSync(dir, { recursive: true });
const cli = process.env.SUPABASE_BIN || "supabase";
const env = {
  ...process.env,
  SUPABASE_HOME: process.env.SUPABASE_HOME || path.join(local, "cli-state"),
  SUPABASE_INTERNAL_IMAGE_REGISTRY: "docker.io",
};
const records = [];
function redact(s) {
  for (const v of Object.values(status))
    if (
      typeof v === "string" &&
      v.length > 15 &&
      !v.startsWith("http://127.0.0.1")
    )
      s = s.replaceAll(v, "[REDACTED]");
  return s.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[JWT REDACTED]");
}
function run(name, command, args, input) {
  const started = new Date().toISOString();
  const r = spawnSync(command, args, {
    cwd: root,
    env,
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(
    path.join(dir, name + ".log"),
    redact((r.stdout || "") + (r.stderr || "")),
  );
  records.push({
    stage: name,
    command: [command, ...args],
    started,
    finished: new Date().toISOString(),
    exit_code: r.status,
  });
  writeFileSync(
    path.join(dir, "commands.json"),
    JSON.stringify(records, null, 2),
  );
  if (r.status !== 0) throw Error(`${name} failed (${r.status}); see ${dir}`);
  return r.stdout;
}
const sql = (name, input) =>
  run(
    name,
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_ai-career-mentor-foundation",
      "psql",
      "-XAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    input,
  );
const cliRun = (name, args) => run(name, cli, [...args, "--workdir", local]);
try {
  run("baseline-verification", "python3", [
    "scripts/foundation/verify-baseline.py",
  ]);
  const manifest = JSON.parse(
    readFileSync(
      path.join(
        root,
        "planning/reviewed-baseline/review/sql-export-manifest.json",
      ),
    ),
  );
  writeFileSync(
    path.join(dir, "sql-hashes.json"),
    JSON.stringify(manifest, null, 2),
  );
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  const hashes = {};
  for (const f of files) {
    try {
      hashes[f] = createHash("sha256")
        .update(readFileSync(path.join(root, f)))
        .digest("hex");
    } catch {
      hashes[f] = "deleted";
    }
  }
  writeFileSync(
    path.join(dir, "provenance.json"),
    JSON.stringify(
      {
        source_commit: source,
        worktree_status: execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          encoding: "utf8",
        }),
        files: hashes,
        node: process.version,
        started: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  cliRun("tool-version", ["--version"]);
  // First-forward evidence is never reused as the reapply destination.
  cliRun("first-forward-reset", ["db", "reset", "--local", "--no-seed"]);
  const history = sql(
    "first-forward-history",
    "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;",
  );
  const expected = Array.from({ length: 21 }, (_, i) =>
    String(i).padStart(3, "0"),
  );
  if (JSON.stringify(history.trim().split("\n")) !== JSON.stringify(expected))
    throw Error("Unexpected migration history");
  function testStage(stage) {
    const native = cliRun(stage + "-native-cli", [
      "test",
      "db",
      path.join(local, "supabase/tests/database"),
    ]);
    if (!/Files=8, Tests=185/.test(native) || !/Result: PASS/.test(native))
      throw Error("Native CLI assertion count/result mismatch");
    sql(
      stage + "-pgtap-extension",
      "CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;",
    );
    let emitted = 0;
    for (const file of readdirSync(
      path.join(root, "supabase/tests/database"),
    ).sort()) {
      const output = sql(
        stage + "-" + file,
        readFileSync(path.join(root, "supabase/tests/database", file), "utf8"),
      );
      if (/^not ok\b/m.test(output) || /\b(?:SKIP|TODO)\b/.test(output))
        throw Error("TAP failure/skip: " + file);
      const count = (output.match(/^ok\s+\d+\b/gm) || []).length;
      const plan = output.match(/^1\.\.(\d+)$/m);
      if (!plan || count !== Number(plan[1]))
        throw Error("TAP plan mismatch: " + file);
      emitted += count;
    }
    if (emitted !== 185) throw Error("Expected 185 assertions, got " + emitted);
    writeFileSync(
      path.join(dir, stage + "-summary.json"),
      JSON.stringify({
        files: 8,
        assertions: emitted,
        failures: 0,
        skips: 0,
        todos: 0,
      }),
    );
  }
  testStage("first-forward-tests");
  for (const f of readdirSync(path.join(root, "supabase/rollbacks"))
    .sort()
    .reverse())
    sql(
      "reverse-" + f,
      readFileSync(path.join(root, "supabase/rollbacks", f), "utf8"),
    );
  const remaining = sql(
    "reverse-empty-public",
    "SELECT count(*) FROM pg_tables WHERE schemaname='public';",
  );
  if (remaining.trim() !== "0") throw Error("Rollback left application tables");
  // CLI metadata is reset only after all approved downs succeeded and the disposable app schema is empty.
  sql(
    "reverse-clear-approved-history",
    "DELETE FROM supabase_migrations.schema_migrations WHERE version IN (" +
      expected.map((v) => "'" + v + "'").join(",") +
      ");",
  );
  cliRun("reapply", ["migration", "up", "--local"]);
  const reappliedHistory = sql(
    "reapply-history",
    "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;",
  );
  if (
    JSON.stringify(reappliedHistory.trim().split("\n")) !==
    JSON.stringify(expected)
  )
    throw Error("Reapply migration history differs");
  testStage("post-reapply-tests");
  for (const file of readdirSync(path.join(root, "supabase/tests/foundation"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const output = sql(
      "boundary-" + file,
      readFileSync(path.join(root, "supabase/tests/foundation", file), "utf8"),
    );
    const count = (output.match(/^ok\s+\d+\b/gm) || []).length;
    const plan = output.match(/^1\.\.(\d+)$/m);
    if (
      /^not ok\b/m.test(output) ||
      /\b(?:SKIP|TODO)\b/.test(output) ||
      !plan ||
      count !== Number(plan[1])
    )
      throw Error("Boundary TAP failure: " + file);
    console.log(`PASS: ${file}, ${count} assertions`);
  }
  run("concurrency", process.execPath, ["scripts/foundation/concurrency.mjs"]);
  run("baseline-after", "python3", ["scripts/foundation/verify-baseline.py"]);
  console.log(
    "PASS: 21 first forwards; 185 TAP; 21 downs; 21 reapply; 185 post-reapply TAP; boundaries + concurrency. Evidence: " +
      dir,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
