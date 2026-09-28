import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { demoLoop, analyze } from "../src/core";
test("Supabase migration and private group RPC integration", async (t) => {
  const db = new PGlite({ extensions: { postgis } });
  await db.waitReady;
  const ids = Array.from({ length: 8 }, () => randomUUID());
  let invite = "",
    groupId = "";
  let submittedId = randomUUID();
  const points = demoLoop();
  await db.exec(
    "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;",
  );
  for (const id of ids)
    await db.query("insert into auth.users values($1)", [id]);
  const schema = readFileSync(
    path.resolve(__dirname, "../../supabase/schema.sql"),
    "utf8",
  ).replace(/^\uFEFF/, "");
  await db.exec(schema);
  const as = async (i: number | null) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      i === null ? "" : ids[i],
    ]);
    await db.exec("set role authenticated");
  };
  const rpc = async (name: string, args: unknown[] = []) => {
    const q =
      "select public." +
      name +
      "(" +
      args.map((_, i) => "$" + (i + 1)).join(",") +
      ") as result";
    const r = await db.query<{ result: any }>(q, args);
    return r.rows[0].result;
  };
  await t.test(
    "anonymous access and unauthenticated RPC are denied",
    async () => {
      await db.exec("set role anon");
      await assert.rejects(() => rpc("conquer_snapshot"), /permission denied/i);
      await as(null);
      await assert.rejects(() => rpc("conquer_snapshot"), /Autentificare/);
    },
  );
  await t.test("create group returns only its own membership", async () => {
    await as(0);
    groupId = await rpc("conquer_create_group", ["Andrei", "Conquer test"]);
    const s = await rpc("conquer_snapshot");
    invite = s.group.invite;
    assert.equal(s.players.length, 1);
    assert.equal(s.players[0].id, ids[0]);
    assert.equal(s.group.id, groupId);
    assert.equal(invite.length, 32);
  });
  await t.test("the same user cannot create a second group", async () => {
    await assert.rejects(
      () => rpc("conquer_create_group", ["Andrei", "Other"]),
      /deja/,
    );
  });
  await t.test("invalid invitations do not reveal groups", async () => {
    await as(1);
    assert.equal(await rpc("conquer_snapshot"), null);
    await assert.rejects(
      () => rpc("conquer_join_group", ["Other", "0".repeat(32)]),
      /nevalid/,
    );
  });
  await t.test("exactly five members can join, idempotently", async () => {
    for (let i = 1; i < 5; i++) {
      await as(i);
      assert.equal(
        await rpc("conquer_join_group", ["Player " + i, invite]),
        groupId,
      );
    }
    assert.equal(
      await rpc("conquer_join_group", ["Player 4", invite]),
      groupId,
    );
    await as(5);
    await assert.rejects(
      () => rpc("conquer_join_group", ["Sixth", invite]),
      /5 jucători/,
    );
  });
  await t.test(
    "server computes area from route instead of trusting client",
    async () => {
      await as(0);
      const result = await rpc("conquer_submit", [
        submittedId,
        JSON.stringify(points),
      ]);
      assert.ok(result.area > 1e5 && result.area < 1.1e5);
      assert.ok(
        Math.abs(result.area - analyze(points).area) / result.area < 0.01,
      );
      const s = await rpc("conquer_snapshot");
      assert.equal(s.territories.length, 1);
      assert.equal(s.territories[0].playerId, ids[0]);
      assert.equal(s.players.length, 5);
      assert.equal(JSON.stringify(s).includes("timestamp"), false);
    },
  );
  await t.test(
    "duplicate IDs and identical routes do not apply capture twice",
    async () => {
      const a = await rpc("conquer_submit", [
        submittedId,
        JSON.stringify(points),
      ]);
      const b = await rpc("conquer_submit", [
        randomUUID(),
        JSON.stringify(points),
      ]);
      assert.equal(a.duplicate, true);
      assert.equal(b.duplicate, true);
    },
  );
  await t.test(
    "full takeover removes previous owner and stale retry cannot steal it back",
    async () => {
      await as(1);
      await rpc("conquer_submit", [randomUUID(), JSON.stringify(points)]);
      await as(0);
      await rpc("conquer_submit", [submittedId, JSON.stringify(points)]);
      const s = await rpc("conquer_snapshot");
      assert.equal(s.territories.length, 1);
      assert.equal(s.territories[0].playerId, ids[1]);
    },
  );
  await t.test("changed payload for an existing ID is rejected", async () => {
    await assert.rejects(
      () =>
        rpc("conquer_submit", [
          submittedId,
          JSON.stringify(demoLoop(44.439, 26.086)),
        ]),
      /Identificator/,
    );
  });
  await t.test("partial capture preserves disjoint territories", async () => {
    await as(2);
    await rpc("conquer_submit", [
      randomUUID(),
      JSON.stringify(demoLoop(44.439, 26.088)),
    ]);
    const s = await rpc("conquer_snapshot");
    assert.equal(s.territories.length, 2);
    await db.exec("reset role");
    const r = await db.query<{ overlap: number }>(
      "select gis.st_area(gis.st_intersection(a.geom,b.geom)) as overlap from conquer_private.territories a join conquer_private.territories b on a.group_id=b.group_id and a.user_id<b.user_id",
    );
    assert.equal(r.rows[0].overlap, 0);
    await as(2);
  });
  await t.test(
    "teleporting and open routes save without claiming",
    async () => {
      const speed = points.map((p, i) => ({
        ...p,
        timestamp: Date.now() - 10000 + i * 100,
      }));
      assert.equal(
        (await rpc("conquer_submit", [randomUUID(), JSON.stringify(speed)]))
          .area,
        0,
      );
      assert.equal(
        (
          await rpc("conquer_submit", [
            randomUUID(),
            JSON.stringify(points.slice(0, 50)),
          ])
        ).area,
        0,
      );
    },
  );
  await t.test(
    "raw coordinates and membership tables cannot be read directly",
    async () => {
      await assert.rejects(
        () => db.query("select * from conquer_private.runs"),
        /permission denied/i,
      );
      await assert.rejects(
        () =>
          db.query("update conquer_private.territories set user_id=$1", [
            ids[2],
          ]),
        /permission denied/i,
      );
    },
  );
  await t.test("nonmembers cannot submit or see another group", async () => {
    await as(6);
    assert.equal(await rpc("conquer_snapshot"), null);
    await assert.rejects(
      () => rpc("conquer_submit", [randomUUID(), JSON.stringify(points)]),
      /grup/,
    );
    await rpc("conquer_create_group", ["Separate", "Another"]);
    const s = await rpc("conquer_snapshot");
    assert.equal(s.players.length, 1);
    assert.equal(s.territories.length, 0);
    assert.notEqual(s.group.id, groupId);
  });
  await t.test("only group owner can rotate an invitation", async () => {
    await as(1);
    await assert.rejects(() => rpc("conquer_rotate_invite"), /creatorul/);
    await as(0);
    const token = await rpc("conquer_rotate_invite");
    assert.notEqual(token, invite);
  });
  await t.test(
    "invalid coordinates and stale activities cannot alter the board",
    async () => {
      await as(0);
      const before = await rpc("conquer_snapshot");
      const invalid = points.map((p) => ({ ...p, latitude: 95 }));
      await assert.rejects(
        () => rpc("conquer_submit", [randomUUID(), JSON.stringify(invalid)]),
        /nevalid/,
      );
      const stale = points.map((p) => ({
        ...p,
        timestamp: p.timestamp - 8 * 86400000,
      }));
      await assert.rejects(
        () => rpc("conquer_submit", [randomUUID(), JSON.stringify(stale)]),
        /7 zile/,
      );
      assert.deepEqual(
        (await rpc("conquer_snapshot")).territories,
        before.territories,
      );
    },
  );
  await db.close();
});
