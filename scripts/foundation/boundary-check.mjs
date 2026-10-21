import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const dir = process.env.FOUNDATION_ARTIFACTS || "artifacts/boundaries";
mkdirSync(dir, { recursive: true });
for (const file of readdirSync("supabase/tests/foundation")
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  const r = spawnSync(
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
    {
      input: readFileSync(path.join("supabase/tests/foundation", file)),
      encoding: "utf8",
    },
  );
  const output = r.stdout + r.stderr;
  writeFileSync(path.join(dir, file + ".log"), output);
  const count = (output.match(/^ok\s+\d+\b/gm) || []).length,
    plan = output.match(/^1\.\.(\d+)$/m);
  if (
    r.status !== 0 ||
    /^not ok\b/m.test(output) ||
    /\b(?:SKIP|TODO)\b/.test(output) ||
    !plan ||
    count !== Number(plan[1])
  )
    throw Error(`Boundary failure: ${file}; inspect ${dir}`);
  console.log(`PASS: ${file}, ${count} assertions`);
}
