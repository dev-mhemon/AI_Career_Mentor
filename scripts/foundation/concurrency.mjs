import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const { Client } = require("pg");
const local = process.env.MENTOR_LOCAL_DIR || path.resolve(".local/foundation");
const status = JSON.parse(readFileSync(path.join(local, "status.json")));
if (new URL(status.DB_URL).port !== "56322")
  throw Error("Refusing non-foundation DB");
const admin = new Client({ connectionString: status.DB_URL });
const a = new Client({ connectionString: status.DB_URL });
const b = new Client({ connectionString: status.DB_URL });
await Promise.all([admin.connect(), a.connect(), b.connect()]);
const users = [randomUUID(), randomUUID(), randomUUID()];
const skill = randomUUID(),
  topic = randomUUID();
let original;
try {
  original = (
    await admin.query(
      "SELECT config_value FROM public.system_configurations WHERE config_key='quality.report_auto_hide_threshold'",
    )
  ).rows[0].config_value;
  await admin.query(
    "UPDATE public.system_configurations SET config_value='2' WHERE config_key='quality.report_auto_hide_threshold'",
  );
  for (const id of users) {
    await admin.query("INSERT INTO auth.users(id) VALUES($1)", [id]);
    await admin.query("INSERT INTO public.users(id) VALUES($1)", [id]);
  }
  await admin.query(
    "INSERT INTO public.skills(id,slug,canonical_name) VALUES($1,$2,'Concurrency Skill')",
    [skill, "concurrency-" + skill],
  );
  await admin.query(
    "INSERT INTO public.topics(id,skill_id,slug,title,career_level,status,explanation_markdown,approved_at) VALUES($1,$2,$3,'Concurrency topic','mid','approved','Text',now())",
    [topic, skill, "concurrency-" + topic],
  );
  const begin = async (c) => {
    await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await c.query("SET LOCAL ROLE service_role");
  };
  const lock = (c) =>
    c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('topic_content:' || $1::text,0))",
      [topic],
    );
  const insert = (c, id) =>
    c.query(
      "INSERT INTO public.content_reports(user_id,target_type,target_id,reason) VALUES($1,'topic_content',$2,'incorrect')",
      [id, topic],
    );
  await begin(a);
  await lock(a);
  await begin(b);
  let acquired = false;
  const pending = lock(b).then(() => {
    acquired = true;
  });
  // Establish actual lock contention using pg_locks, rather than trusting a sleep.
  const bPid = b.processID;
  let blocked = false;
  for (let n = 0; n < 100; n++) {
    const r = await admin.query(
      "SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted",
      [bPid],
    );
    if (r.rowCount) {
      blocked = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(
    blocked,
    "second connection must block on first transaction advisory lock",
  );
  assert.equal(acquired, false);
  await insert(a, users[0]);
  await a.query("COMMIT");
  await pending;
  assert(acquired);
  await insert(b, users[1]);
  await b.query("COMMIT");
  assert.equal(
    (await admin.query("SELECT status FROM public.topics WHERE id=$1", [topic]))
      .rows[0].status,
    "hidden",
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(DISTINCT user_id)::int AS n FROM public.content_reports WHERE target_id=$1",
        [topic],
      )
    ).rows[0].n,
    2,
  );
  await begin(a);
  await lock(a);
  await assert.rejects(insert(a, users[0]), (e) => e.code === "23505");
  await a.query("ROLLBACK");
  await begin(b);
  await lock(b);
  await insert(b, users[2]);
  await b.query("ROLLBACK");
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM public.content_reports WHERE target_id=$1",
        [topic],
      )
    ).rows[0].n,
    2,
  );
  console.log(
    "PASS: two independent READ COMMITTED sessions, lock-before-insert, threshold=2, duplicate rejected, transaction rollback preserved count",
  );
} finally {
  await Promise.allSettled([a.query("ROLLBACK"), b.query("ROLLBACK")]);
  if (original !== undefined)
    await admin.query(
      "UPDATE public.system_configurations SET config_value=$1 WHERE config_key='quality.report_auto_hide_threshold'",
      [JSON.stringify(original)],
    );
  for (const id of users)
    await admin.query("DELETE FROM auth.users WHERE id=$1", [id]);
  await admin.query("DELETE FROM public.topics WHERE id=$1", [topic]);
  await admin.query("DELETE FROM public.skills WHERE id=$1", [skill]);
  await Promise.all([admin.end(), a.end(), b.end()]);
}
