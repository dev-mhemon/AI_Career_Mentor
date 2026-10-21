/** Real HTTP checks against compiled Nest and local Supabase Auth, with disposable synthetic accounts. */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID, createPrivateKey, sign } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const { Client } = require("pg");
const local = process.env.MENTOR_LOCAL_DIR || path.resolve(".local/foundation");
const status = JSON.parse(readFileSync(path.join(local, "status.json"))),
  config = JSON.parse(readFileSync(path.join(local, "backend.json")));
if (new URL(status.DB_URL).port !== "56322")
  throw Error("Only disposable foundation DB allowed");
const db = new Client({ connectionString: status.DB_URL });
await db.connect();
const base = "http://127.0.0.1:3202";
const app = spawn(process.execPath, ["dist/main.js"], {
  cwd: path.resolve("backend"),
  env: { ...process.env, ...config, PORT: "3202" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
app.stdout.on("data", (b) => {
  output += b;
});
app.stderr.on("data", (b) => {
  output += b;
});
const results = [];
let completed = false;
const users = [];
const skill = randomUUID(),
  role = randomUUID();
let tokens = [];
async function check(name, fn) {
  await fn();
  results.push({ name, status: "passed" });
  console.log("PASS: " + name);
}
async function api(endpoint, token, method = "GET", body) {
  const r = await fetch(base + "/api/v1" + endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await r.json();
  assert.match(r.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  return { status: r.status, ...json };
}
async function auth(endpoint, method, body, key = status.SERVICE_ROLE_KEY) {
  const r = await fetch(status.API_URL + "/auth/v1" + endpoint, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw Error("Local Auth fixture request failed: " + r.status);
  return j;
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, "compiled backend health readiness");
  await check("missing and malformed bearer rejected", async () => {
    const absent = await api("/profile");
    assert.equal(absent.status, 401);
    assert.equal(absent.error.code, "AUTH_REQUIRED");
    const invalid = await api("/profile", "malformed");
    assert.equal(invalid.status, 401);
    assert.equal(invalid.error.code, "INVALID_TOKEN");
  });
  for (let i = 0; i < 2; i++) {
    const email = `foundation-${randomUUID()}@test.local`,
      password = randomUUID() + "A!9";
    const u = await auth("/admin/users", "POST", {
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "ADMIN", verified_contact: true },
    });
    users.push(u.id);
    const session = await auth(
      "/token?grant_type=password",
      "POST",
      { email, password },
      status.ANON_KEY,
    );
    tokens.push(session.access_token);
  }
  await check(
    "missing application mapping fails closed before bootstrap",
    async () => {
      assert.equal((await api("/profile", tokens[0])).status, 401);
    },
  );
  await check(
    "live Auth bootstrap maps exact UUID and ignores metadata role",
    async () => {
      for (let i = 0; i < 2; i++) {
        const r = await api("/auth/sync", tokens[i], "POST");
        assert.equal(r.status, 200, JSON.stringify(r.error));
        assert.equal(r.data.user.id, users[i]);
        assert.equal(r.data.user.role, "USER");
        assert.equal(r.data.user.verified_contact, true);
        assert.equal(r.data.profile_complete, false);
      }
    },
  );
  await check(
    "bootstrap is idempotent and creates one profile/provider",
    async () => {
      await api("/auth/sync", tokens[0], "POST");
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM public.user_profiles WHERE user_id=$1",
            [users[0]],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM public.user_auth_providers WHERE user_id=$1",
            [users[0]],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check(
    "contact collisions fail closed with 409 and preserve both UUID mappings",
    async () => {
      const contacts = (
        await db.query(
          "SELECT id,email FROM public.users WHERE id=ANY($1::uuid[])",
          [users.slice(0, 2)],
        )
      ).rows;
      const first = contacts.find((u) => u.id === users[0]),
        second = contacts.find((u) => u.id === users[1]);
      try {
        await db.query("UPDATE public.users SET email=NULL WHERE id=$1", [
          users[1],
        ]);
        await db.query("UPDATE public.users SET email=$2 WHERE id=$1", [
          users[0],
          second.email,
        ]);
        const response = await api("/auth/sync", tokens[1], "POST");
        assert.equal(response.status, 409);
        assert.equal(response.error.code, "IDENTITY_LINK_CONFLICT");
        assert.equal(
          (
            await db.query("SELECT email FROM public.users WHERE id=$1", [
              users[1],
            ])
          ).rows[0].email,
          null,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM public.users WHERE id=ANY($1::uuid[])",
              [users.slice(0, 2)],
            )
          ).rows[0].n,
          2,
        );
      } finally {
        await db.query("UPDATE public.users SET email=$2 WHERE id=$1", [
          users[0],
          first.email,
        ]);
        await db.query("UPDATE public.users SET email=$2 WHERE id=$1", [
          users[1],
          second.email,
        ]);
      }
    },
  );
  await check("auth/me reads without foreground activity writes", async () => {
    const before = (
      await db.query("SELECT last_active_at FROM public.users WHERE id=$1", [
        users[0],
      ])
    ).rows[0].last_active_at;
    assert.equal((await api("/auth/me", tokens[0])).status, 200);
    assert.deepEqual(
      (
        await db.query("SELECT last_active_at FROM public.users WHERE id=$1", [
          users[0],
        ])
      ).rows[0].last_active_at,
      before,
    );
  });
  await check("provider mismatch rejected using live identities", async () => {
    assert.equal(
      (
        await api("/auth/oauth/session", tokens[0], "POST", {
          provider: "facebook",
        })
      ).status,
      422,
    );
  });
  await db.query(
    "INSERT INTO public.skills(id,slug,canonical_name) VALUES($1,$2,'Foundation Skill')",
    [skill, "foundation-" + skill],
  );
  await db.query(
    "INSERT INTO public.career_roles(id,slug,name) VALUES($1,$2,'Foundation Role')",
    [role, "foundation-" + role],
  );
  await check(
    "profile validation rejects unknowns, blanks, overlong names and None plus skills",
    async () => {
      for (const body of [
        { role: "ADMIN" },
        { current_role: " " },
        { existing_skills: [{ name: "a".repeat(81) }] },
        {
          existing_skills_none: true,
          existing_skills: [{ name: "Foundation Skill" }],
        },
      ]) {
        assert.equal(
          (await api("/profile", tokens[0], "PATCH", body)).status,
          422,
        );
      }
    },
  );
  await check(
    "profile aliases defer progress until confirmed level; uncertain alias has no artificial skill",
    async () => {
      const p = await api("/profile", tokens[0], "PATCH", {
        current_role: " Student ",
        experience_level: "beginner",
        existing_skills: [
          { name: "Foundation Skill" },
          { name: "unrecognizable skill xyz" },
        ],
      });
      assert.equal(p.status, 200);
      assert.equal(p.data.current_role, "Student");
      assert.equal(
        p.data.progress_initialization,
        "deferred_until_level_confirmation",
      );
      assert.equal(p.data.unresolved_skills.length, 1);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM public.skill_progress WHERE user_id=$1",
            [users[0]],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await check(
    "None is valid, clears self-reported skills, and profile completion is deterministic",
    async () => {
      await api("/profile", tokens[0], "PATCH", { existing_skills_none: true });
      await api("/profile/preferences", tokens[0], "PATCH", {
        learning_preference: "mixed",
      });
      const p = await api("/profile/learning-settings", tokens[0], "PATCH", {
        timezone: "Asia/Dhaka",
        preferred_daily_hours: 1.5,
      });
      assert.equal(p.status, 200, JSON.stringify(p.error));
      assert.equal(p.data.profile_complete, false);
      assert.deepEqual(p.data.missing_fields, ["active_career_goal_ids"]);
      assert.equal(
        (await api("/auth/me", tokens[0])).data.profile_complete,
        false,
      );
      assert.equal(p.data.existing_skills.length, 0);
      assert.equal(
        (
          await api("/profile/learning-settings", tokens[0], "PATCH", {
            preferred_daily_hours: 1.2,
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await api("/profile/learning-settings", tokens[0], "PATCH", {
            timezone: "Bad/Zone",
          })
        ).status,
        422,
      );
    },
  );
  await check(
    "C05 error details retain nested paths, endpoint codes and request IDs",
    async () => {
      const invalid = await api("/profile", tokens[0], "PATCH", {
        existing_skills: [{ name: "" }],
      });
      assert.equal(invalid.status, 422);
      assert(
        invalid.error.details.some(
          (d) =>
            d.field === "existing_skills.0.name" &&
            typeof d.code === "string" &&
            typeof d.message === "string",
        ),
      );
      assert(!JSON.stringify(invalid.error).includes("constraints"));
      assert.equal(
        (
          await api("/profile/learning-settings", tokens[0], "PATCH", {
            timezone: "Bad/Zone",
          })
        ).error.code,
        "INVALID_TIMEZONE",
      );
      assert.equal(
        (
          await api("/profile/skill-alias-interpretations", tokens[0], "POST", {
            input: "missing",
            skill_id: randomUUID(),
          })
        ).error.code,
        "SKILL_NOT_FOUND",
      );
      assert.equal(
        (await api("/career/goals/not-a-uuid", tokens[0])).status,
        400,
      );
    },
  );
  await check(
    "foreground success coalesces; reads, failed work and future timestamps do not advance activity",
    async () => {
      await db.query(
        "UPDATE public.users SET last_active_at=now()-interval '10 minutes' WHERE id=$1",
        [users[0]],
      );
      const stamp = async () =>
        (
          await db.query(
            "SELECT last_active_at FROM public.users WHERE id=$1",
            [users[0]],
          )
        ).rows[0].last_active_at;
      const old = await stamp();
      await api("/auth/me", tokens[0]);
      await api("/profile", tokens[0]);
      assert.deepEqual(await stamp(), old);
      await api("/profile/preferences", tokens[0], "PATCH", {
        learning_preference: "invalid",
      });
      assert.deepEqual(await stamp(), old);
      assert.equal(
        (
          await api("/profile/preferences", tokens[0], "PATCH", {
            learning_preference: "reading",
          })
        ).status,
        200,
      );
      const current = await stamp();
      assert(current > old);
      await api("/profile/learning-settings", tokens[0], "PATCH", {
        preferred_daily_hours: 2,
      });
      assert.deepEqual(await stamp(), current);
      await db.query(
        "UPDATE public.users SET last_active_at=now()+interval '1 hour' WHERE id=$1",
        [users[0]],
      );
      const future = await stamp();
      await api("/profile/preferences", tokens[0], "PATCH", {
        learning_preference: "mixed",
      });
      assert.deepEqual(await stamp(), future);
    },
  );
  await check(
    "activity persistence failure rolls back the successful-looking profile edit and leaks no SQL",
    async () => {
      const name = "alignment_activity_" + randomUUID().replaceAll("-", "");
      await db.query(
        "UPDATE public.users SET last_active_at=now()-interval '10 minutes' WHERE id=$1",
        [users[0]],
      );
      const before = (
        await db.query("SELECT last_active_at FROM public.users WHERE id=$1", [
          users[0],
        ])
      ).rows[0].last_active_at;
      const preference = (
        await db.query(
          "SELECT learning_preference FROM public.user_preferences WHERE user_id=$1",
          [users[0]],
        )
      ).rows[0].learning_preference;
      await db.query(
        `CREATE FUNCTION private.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private SQL details'; END $$`,
      );
      await db.query(
        `CREATE TRIGGER ${name} BEFORE UPDATE OF last_active_at ON public.users FOR EACH ROW WHEN (NEW.id='${users[0]}'::uuid) EXECUTE FUNCTION private.${name}()`,
      );
      try {
        const reply = await api("/profile/preferences", tokens[0], "PATCH", {
          learning_preference: preference === "reading" ? "visual" : "reading",
        });
        assert.equal(reply.status, 500);
        assert.equal(reply.error.message, "Internal server error");
        assert(
          !JSON.stringify(reply.error).includes(
            "synthetic private SQL details",
          ),
        );
        assert.equal(
          (
            await db.query(
              "SELECT learning_preference FROM public.user_preferences WHERE user_id=$1",
              [users[0]],
            )
          ).rows[0].learning_preference,
          preference,
        );
        assert.deepEqual(
          (
            await db.query(
              "SELECT last_active_at FROM public.users WHERE id=$1",
              [users[0]],
            )
          ).rows[0].last_active_at,
          before,
        );
      } finally {
        await db.query(`DROP TRIGGER ${name} ON public.users`);
        await db.query(`DROP FUNCTION private.${name}()`);
      }
    },
  );
  await check(
    "user alias is atomic, deduplicated, private and never promoted globally",
    async () => {
      for (let i = 0; i < 2; i++) {
        const r = await api(
          "/profile/skill-alias-interpretations",
          tokens[0],
          "POST",
          { input: "my node", skill_id: i === 1 ? skill.toUpperCase() : skill },
        );
        assert.equal(r.status, 201);
        assert.equal(
          r.data.progress_initialization,
          "deferred_until_level_confirmation",
        );
      }
      assert.equal(
        (
          await db.query(
            "SELECT cardinality(self_reported_skill_ids) AS n FROM public.user_profiles WHERE user_id=$1",
            [users[0]],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM public.skill_aliases WHERE alias_normalized='my node'",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await api("/profile", tokens[1])).data.existing_skills.length,
        0,
      );
    },
  );
  await check(
    "canonical, validated global and user aliases resolve without cross-user leakage",
    async () => {
      await db.query(
        "INSERT INTO public.skill_aliases(skill_id,alias,alias_normalized,status,validated_at) VALUES($1,'Global Foundation Alias','global foundation alias','validated',now())",
        [skill],
      );
      const privateMatch = await api("/profile", tokens[0], "PATCH", {
        existing_skills: [{ name: "my node" }],
      });
      assert.equal(privateMatch.data.existing_skills[0].skill_id, skill);
      const foreignMatch = await api("/profile", tokens[1], "PATCH", {
        existing_skills: [{ name: "my node" }],
      });
      assert.equal(foreignMatch.data.existing_skills.length, 0);
      assert.equal(foreignMatch.data.unresolved_skills.length, 1);
      const globalMatch = await api("/profile", tokens[0], "PATCH", {
        existing_skills: [{ name: "Global Foundation Alias" }],
      });
      assert.equal(globalMatch.data.existing_skills[0].skill_id, skill);
    },
  );
  const goals = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    goals.push(id);
    await db.query(
      "INSERT INTO public.career_goals(id,user_id,goal_text,status,proposed_role_id,suggested_level) VALUES($1,$2,'Foundation goal','awaiting_confirmation',$3,'junior')",
      [id, users[0], role],
    );
  }
  await check(
    "goal confirmation obeys global and per-user roadmap access while existing reads remain available",
    async () => {
      const previous = (
        await db.query(
          "SELECT enabled FROM public.feature_controls WHERE feature_key='roadmap_generator'",
        )
      ).rows[0].enabled;
      try {
        await db.query(
          "UPDATE public.feature_controls SET enabled=false WHERE feature_key='roadmap_generator'",
        );
        await db.query(
          "INSERT INTO public.user_access_overrides(user_id,feature_key,enabled) VALUES($1,'roadmap_generator',true)",
          [users[0]],
        );
        const body = { canonical_role_id: role, target_level: "mid" };
        assert.equal(
          (
            await api(
              "/career/goals/" + goals[0] + "/confirm",
              tokens[0],
              "POST",
              body,
            )
          ).error.code,
          "FEATURE_DISABLED",
        );
        assert.equal(
          (await api("/career/goals/" + goals[0], tokens[0])).status,
          200,
        );
        assert.equal((await api("/profile", tokens[0])).status, 200);
        await db.query(
          "UPDATE public.feature_controls SET enabled=true WHERE feature_key='roadmap_generator'",
        );
        await db.query(
          "UPDATE public.user_access_overrides SET enabled=false WHERE user_id=$1 AND feature_key='roadmap_generator'",
          [users[0]],
        );
        assert.equal(
          (
            await api(
              "/career/goals/" + goals[0] + "/confirm",
              tokens[0],
              "POST",
              body,
            )
          ).status,
          403,
        );
        assert.equal(
          (await api("/career/goals/" + goals[0], tokens[0])).data.status,
          "awaiting_confirmation",
        );
      } finally {
        await db.query(
          "DELETE FROM public.user_access_overrides WHERE user_id=$1 AND feature_key='roadmap_generator'",
          [users[0]],
        );
        await db.query(
          "UPDATE public.feature_controls SET enabled=$1 WHERE feature_key='roadmap_generator'",
          [previous],
        );
      }
    },
  );
  await check(
    "foreign goal path returns 404, even for platform admin",
    async () => {
      await db.query("INSERT INTO public.admin_users(user_id) VALUES($1)", [
        users[1],
      ]);
      assert.equal(
        (await api("/career/goals/" + goals[0], tokens[1])).status,
        404,
      );
      assert.equal(
        (
          await api(
            "/career/goals/" + goals[0] + "/confirm",
            tokens[1],
            "POST",
            { canonical_role_id: role, target_level: "mid" },
          )
        ).status,
        404,
      );
    },
  );
  await check("role mismatch and invalid level cannot confirm", async () => {
    assert.equal(
      (
        await api("/career/goals/" + goals[0] + "/confirm", tokens[0], "POST", {
          canonical_role_id: randomUUID(),
          target_level: "mid",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await api("/career/goals/" + goals[0] + "/confirm", tokens[0], "POST", {
          canonical_role_id: role,
          target_level: "beginner",
        })
      ).status,
      422,
    );
  });
  await check(
    "goal confirmation initializes chosen level only and preserves stronger evidence",
    async () => {
      await db.query(
        "INSERT INTO public.skill_progress(user_id,skill_id,career_level,learning_state,state_reason) VALUES($1,$2,'mid','not_started','Self-reported skill; confirmed goal level')",
        [users[0], skill],
      );
      const r = await api(
        "/career/goals/" + goals[0] + "/confirm",
        tokens[0],
        "POST",
        { canonical_role_id: role, target_level: "mid" },
      );
      assert.equal(r.status, 200);
      const profileState = (await api("/profile", tokens[0])).data;
      assert.equal(profileState.education, null);
      assert.equal(profileState.profile_complete, true);
      assert.deepEqual(profileState.missing_fields, []);
      assert.equal(
        (await api("/auth/me", tokens[0])).data.profile_complete,
        true,
      );
      let rows = (
        await db.query("SELECT * FROM public.skill_progress WHERE user_id=$1", [
          users[0],
        ])
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].career_level, "mid");
      assert.equal(rows[0].learning_state, "learning");
      await db.query(
        "UPDATE public.skill_progress SET learning_state='proficient',state_reason='Verified evidence',evidence_count=3 WHERE user_id=$1",
        [users[0]],
      );
      await api("/profile/skill-alias-interpretations", tokens[0], "POST", {
        input: "my node",
        skill_id: skill,
      });
      rows = (
        await db.query("SELECT * FROM public.skill_progress WHERE user_id=$1", [
          users[0],
        ])
      ).rows;
      assert.equal(rows[0].learning_state, "proficient");
      assert.equal(rows[0].evidence_count, 3);
      const profile = await api("/profile", tokens[0]);
      assert.equal(
        profile.data.existing_skills[0].learning_state,
        "proficient",
      );
      assert.equal(profile.data.existing_skills[0].source, "evidence");
    },
  );
  await check(
    "repeat confirmation is invalid; fourth active goal blocked",
    async () => {
      assert.equal(
        (
          await api(
            "/career/goals/" + goals[0] + "/confirm",
            tokens[0],
            "POST",
            { canonical_role_id: role, target_level: "mid" },
          )
        ).status,
        409,
      );
      for (const id of goals.slice(1, 3))
        assert.equal(
          (
            await api("/career/goals/" + id + "/confirm", tokens[0], "POST", {
              canonical_role_id: role,
              target_level: "senior",
            })
          ).status,
          200,
        );
      assert.equal(
        (
          await api(
            "/career/goals/" + goals[3] + "/confirm",
            tokens[0],
            "POST",
            { canonical_role_id: role, target_level: "junior" },
          )
        ).status,
        409,
      );
    },
  );
  await check(
    "suspension is immediate, bootstrap preserves it, auth/me exposes all access false",
    async () => {
      await db.query(
        "UPDATE public.users SET status='suspended',suspended_at=now() WHERE id=$1",
        [users[0]],
      );
      assert.equal((await api("/profile", tokens[0])).status, 403);
      assert.equal(
        (await api("/profile", tokens[0], "PATCH", { education: "changed" }))
          .status,
        403,
      );
      assert.equal(
        (await api("/auth/sync", tokens[0], "POST")).data.user.status,
        "suspended",
      );
      const r = await api("/auth/me", tokens[0]);
      assert.equal(r.status, 200);
      assert(Object.values(r.data.effective_access).every((v) => v === false));
      assert.equal(r.data.can_delete_account, true);
    },
  );
  await check(
    "signed tokens reject expired/issuer/audience/subject tampering",
    async () => {
      const key = JSON.parse(
        readFileSync(path.join(local, "supabase/signing_keys.json")),
      )[0];
      const original = JSON.parse(
        Buffer.from(tokens[1].split(".")[1], "base64url"),
      );
      for (const patch of [
        { exp: 1 },
        { iss: "https://attacker.invalid/auth/v1" },
        { aud: "anon" },
        { sub: "not-a-uuid" },
      ]) {
        const h = Buffer.from(
          JSON.stringify({ alg: "ES256", kid: key.kid, typ: "JWT" }),
        ).toString("base64url");
        const p = Buffer.from(
          JSON.stringify({ ...original, ...patch }),
        ).toString("base64url");
        const s = sign("sha256", Buffer.from(h + "." + p), {
          key: createPrivateKey({ key, format: "jwk" }),
          dsaEncoding: "ieee-p1363",
        }).toString("base64url");
        assert.equal(
          (await api("/auth/me", h + "." + p + "." + s)).status,
          401,
        );
      }
    },
  );
  await check(
    "unverified contact metadata cannot assert verification",
    async () => {
      const email = `foundation-${randomUUID()}@test.local`;
      const u = await auth("/admin/users", "POST", {
        email,
        email_confirm: false,
        user_metadata: {
          verified_contact: true,
          email_verified: true,
          role: "ADMIN",
        },
      });
      users.push(u.id);
      const key = JSON.parse(
        readFileSync(path.join(local, "supabase/signing_keys.json")),
      )[0];
      const h = Buffer.from(
        JSON.stringify({ alg: "ES256", kid: key.kid }),
      ).toString("base64url");
      const p = Buffer.from(
        JSON.stringify({
          sub: u.id,
          exp: Math.floor(Date.now() / 1000) + 60,
          iss: status.API_URL + "/auth/v1",
          aud: "authenticated",
          role: "authenticated",
        }),
      ).toString("base64url");
      const s = sign("sha256", Buffer.from(h + "." + p), {
        key: createPrivateKey({ key, format: "jwk" }),
        dsaEncoding: "ieee-p1363",
      }).toString("base64url");
      const r = await api("/auth/sync", h + "." + p + "." + s, "POST");
      assert.equal(r.status, 200);
      assert.equal(r.data.user.verified_contact, false);
      assert.equal(r.data.user.email, null);
      assert.equal(r.data.user.role, "USER");
    },
  );
  await check(
    "deleted Auth identity cannot be re-provisioned with an old token",
    async () => {
      await auth("/admin/users/" + users[1], "DELETE");
      assert.equal((await api("/auth/sync", tokens[1], "POST")).status, 401);
      assert.equal((await api("/auth/me", tokens[1])).status, 401);
    },
  );
  completed = true;
} finally {
  app.kill("SIGTERM");
  for (const id of users)
    await db.query("DELETE FROM auth.users WHERE id=$1", [id]);
  await db.query("DELETE FROM public.skills WHERE id=$1", [skill]);
  await db.query("DELETE FROM public.career_roles WHERE id=$1", [role]);
  await db.end();
  mkdirSync("artifacts/application", { recursive: true });
  writeFileSync(
    "artifacts/application/results.json",
    JSON.stringify(
      {
        source_commit: process.env.GITHUB_SHA || null,
        executed_at: new Date().toISOString(),
        checks: results,
        status: completed ? "passed" : "failed",
      },
      null,
      2,
    ),
  );
  // App log is intentionally retained privately; unexpected DB errors may contain contact data.
  writeFileSync(path.join(local, "application-check.private.log"), output, {
    mode: 0o600,
  });
}
console.log(
  `PASS: ${results.length} real HTTP/Auth/database foundation checks`,
);
