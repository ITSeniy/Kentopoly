import test from "node:test";
import assert from "node:assert/strict";
import {
  scenePosition,
  sceneInward,
  sceneLabelAngle,
  sceneTileSize,
  scenePawnPosition,
  sceneBuildingKind,
} from "../public/scene.mjs";
import {
  createGame,
  addPlayer,
  apply,
  publicState,
  migrateTableLayout,
  seeded,
} from "../public/engine.mjs";
import { BANKS, CHANCE } from "../public/data.mjs";
function game() {
  let s = createGame("table-test", 42);
  for (let i = 0; i < 3; i++) {
    addPlayer(s, "p" + i, "Кент " + i, BANKS[i].id);
    s.players.at(-1).ready = true;
  }
  s = apply(s, "p0", { type: "start" }, 1000000, seeded(12));
  s.active = "p0";
  s.phase = { type: "roll", until: 1100000 };
  return s;
}
const p = (s) => s.players.find((p) => p.id === "p0");
test("layout v4 keeps Awards/Search and adds player setup", () => {
  const s = game();
  assert.equal(s.tiles[20].type, "award");
  assert.equal(s.tiles[30].type, "search");
  assert.equal(CHANCE.find((c) => c.name === "Найди место получше").move, 30);
  assert.equal(s.layoutVersion, 4);
});
test("all forty bands face center independently from camera", () => {
  for (let i = 0; i < 40; i++) {
    const [x, z] = scenePosition(i),
      [dx, dz] = sceneInward(i);
    assert.ok(x * dx + z * dz < 0);
    assert.ok(Math.abs(Math.hypot(dx, dz) - 1) < 1e-9);
    assert.deepEqual(sceneInward(i), [dx, dz]);
  }
});
test("labels are printed at fixed angles for the default camera", () => {
  assert.deepEqual([1, 11, 21, 31].map(sceneLabelAngle), [Math.PI, Math.PI / 2, 0, -Math.PI / 2]);
  assert.deepEqual([0, 10, 20, 30].map(sceneLabelAngle), Array(4).fill(Math.PI / 4));
});
test("edge cells are cards, corners stay square, pawns use the outer lane", () => {
  for (let i = 0; i < 40; i++) {
    const [w, d] = sceneTileSize(i);
    if (i % 10 === 0) assert.equal(w, d);
    else assert.ok(d > w);
    const [x, z] = scenePosition(i),
      [px, pz] = scenePawnPosition(i),
      [ix, iz] = sceneInward(i);
    assert.ok((px - x) * ix + (pz - z) * iz < 0);
  }
});
test("purchased level zero has a house; all levels differ", () => {
  assert.equal(sceneBuildingKind({ type: "property", owner: null, level: 0 }), null);
  assert.deepEqual(
    [0, 1, 2, 3].map((level) => sceneBuildingKind({ type: "property", owner: "p0", level })),
    ["house", "shop", "office", "tower"],
  );
  assert.equal(sceneBuildingKind({ type: "fountain", owner: "p0", level: 0 }), null);
});
test("Chance reaches Search 30; Search reaches Awards 20", () => {
  let s = game();
  p(s).pos = 21;
  s.chance = [7];
  s.tiles[1].owner = "p0";
  s = apply(s, "p0", { type: "roll" }, 1000000, () => 0);
  assert.equal(p(s).pos, 30);
  assert.equal(s.phase.type, "search");
  s = apply(s, "p0", { type: "search", tile: 20 }, 1000000, seeded(1));
  assert.equal(s.phase.type, "award");
  s = apply(s, "p0", { type: "award", tile: 1 }, 1000000, seeded(1));
  assert.equal(s.award, 1);
});
test("Search onto itself neither loops nor pays salary", () => {
  let s = game();
  s.phase = { type: "search", until: 1100000 };
  s.searchUsed = true;
  p(s).pos = 30;
  const cash = p(s).cash;
  s = apply(s, "p0", { type: "search", tile: 30 }, 1000000, seeded(1));
  assert.equal(s.phase.type, "manage");
  assert.equal(p(s).cash, cash);
  assert.equal(s.motions.length, 1);
});
test("old save migration is idempotent and preserves assets and privacy", () => {
  let s = game();
  delete s.layoutVersion;
  Object.assign(s.tiles[20], { type: "search", name: "Поиск" });
  Object.assign(s.tiles[30], { type: "award", name: "2026 Awards" });
  p(s).pos = 20;
  s.players.find((q) => q.id === "p1").pos = 30;
  s.tiles[19].owner = "p0";
  s.tiles[19].level = 2;
  s.award = 19;
  s.phase = { type: "search", until: 1100000 };
  s.motions = [{ seq: 8, playerId: "p0", from: 18, to: 20, kind: "walk", steps: 2 }];
  const before = structuredClone(s),
    out = publicState(s, "p0");
  assert.equal(s.tiles[20].type, "search");
  assert.equal(out.tiles[20].type, "award");
  assert.equal(p(out).pos, 30);
  assert.equal(out.players.find((q) => q.id === "p1").pos, 20);
  assert.equal(out.award, 19);
  assert.equal(out.tiles[19].level, 2);
  assert.equal(out.tiles[19].name, before.tiles[19].name);
  assert.equal(p(out).cash, p(before).cash);
  assert.equal(out.motions.length, 0);
  assert.ok(!("chance" in out));
  const migrated = migrateTableLayout(s);
  assert.deepEqual(migrateTableLayout(structuredClone(migrated)), migrated);
});
