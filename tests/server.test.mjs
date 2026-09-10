import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { makeServer } from "../server.mjs";
async function start(dir) {
  const s = makeServer({ dir });
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  return { s, url: "http://127.0.0.1:" + s.address().port };
}
async function stop(s) {
  s.closeAllConnections();
  await new Promise((resolve) => s.close(resolve));
}
async function request(url, route, body, cookie) {
  const r = await fetch(url + route, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: url,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
    header: r.headers.get("set-cookie"),
  };
}
test("real HTTP: six players, seventh rejected, protected state, duplicate commands, restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kentopoly-"));
  let run = await start(dir);
  const aborters = [];
  try {
    const first = await request(run.url, "/api/create", { name: "Хозяин", bank: "sber" });
    assert.equal(first.status, 201);
    assert.match(first.header, /HttpOnly/);
    assert.match(first.header, /SameSite=Strict/);
    const clients = [first];
    for (const [i, bank] of ["tbank", "alfa", "vtb", "psb", "gpb"].entries()) {
      const a = await request(run.url, "/api/join", {
        name: "Друг " + i,
        bank,
        invite: first.data.invite,
      });
      assert.equal(a.status, 200);
      clients.push(a);
    }
    const extra = await request(run.url, "/api/join", {
      name: "Седьмой",
      bank: "sov",
      invite: first.data.invite,
    });
    assert.equal(extra.status, 400);
    assert.match(extra.data.error, /шесть/);
    for (const a of clients) {
      const ac = new AbortController();
      aborters.push(ac);
      const res = await fetch(run.url + "/api/events", {
        headers: { Cookie: a.cookie },
        signal: ac.signal,
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /event-stream/);
      res.body
        .getReader()
        .read()
        .catch(() => {});
    }
    let latest = await request(run.url, "/api/me", null, first.cookie);
    for (let i = 0; i < clients.length; i++) {
      const a = clients[i];
      const out = await request(
        run.url,
        "/api/cmd",
        { commandId: "ready-" + i, version: latest.data.state.version, command: { type: "ready" } },
        a.cookie,
      );
      assert.equal(out.status, 200);
      latest = out;
    }
    const started = latest;
    assert.equal(started.data.state.status, "playing");
    assert.equal(started.data.state.players.length, 6);
    const payload = {
      commandId: "ready-5",
      version: started.data.state.version - 1,
      command: { type: "ready" },
    };
    const duplicate = await request(run.url, "/api/cmd", payload, clients.at(-1).cookie);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(duplicate.data.state.version, started.data.state.version);
    const states = await Promise.all(
      clients.map((a) => request(run.url, "/api/me", null, a.cookie)),
    );
    assert.ok(
      states.every(
        (a) => JSON.stringify(a.data.state.tiles) === JSON.stringify(started.data.state.tiles),
      ),
    );
    assert.ok(states.every((a) => !("chance" in a.data.state) && !("bids" in a.data.state)));
    const wrong = clients.find((a) => a.data.me !== started.data.state.active);
    const bad = await request(
      run.url,
      "/api/cmd",
      { commandId: "wrong-player", version: started.data.state.version, command: { type: "roll" } },
      wrong.cookie,
    );
    assert.equal(bad.status, 400);
    const cs = await fetch(run.url + "/api/cmd", {
      method: "POST",
      headers: {
        Origin: "https://attacker.invalid",
        "Content-Type": "application/json",
        Cookie: first.cookie,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(cs.status, 403);
    const unauthorized = await request(run.url, "/api/me");
    assert.equal(unauthorized.status, 401);
    const saved = started.data.state.tiles;
    for (const a of aborters) a.abort();
    await stop(run.s);
    run = await start(dir);
    const restored = await request(run.url, "/api/me", null, first.cookie);
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.data.state.tiles, saved);
    assert.equal(restored.data.state.version, started.data.state.version);
    assert.equal(restored.data.paused, true);
  } finally {
    for (const a of aborters) a.abort();
    await stop(run.s);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
