import test from "node:test";
import assert from "node:assert/strict";
import {
  scenePosition,
  sceneMotionPath,
  sceneDicePips,
  sceneDiceStage,
} from "../public/scene.mjs";
import { createGame, addPlayer, apply, seeded, publicState } from "../public/engine.mjs";
import { BANKS } from "../public/data.mjs";
function setup() {
  let s = createGame("motion-test", 42);
  for (let i = 0; i < 3; i++) {
    addPlayer(s, "p" + i, "Игрок " + i, BANKS[i].id);
    s.players.at(-1).ready = true;
  }
  s = apply(s, "p0", { type: "start" }, 1000000, seeded(12));
  s.active = "p0";
  s.phase = { type: "roll", until: 1100000 };
  return s;
}
const p = (s) => s.players.find((p) => p.id === "p0");
test("3D geometry: 40 unique perimeter cells and four corners", () => {
  const positions = Array.from({ length: 40 }, (_, i) => scenePosition(i));
  assert.equal(new Set(positions.map((p) => p.join(","))).size, 40);
  for (let i = 0; i < 40; i++) {
    const [x, z] = positions[i],
      [nx, nz] = positions[(i + 1) % 40];
    assert.equal(Math.abs(x - nx) + Math.abs(z - nz), 1);
    assert.equal(Math.max(Math.abs(x), Math.abs(z)), 5);
  }
  assert.deepEqual([0, 10, 20, 30].map(scenePosition), [
    [5, 5],
    [-5, 5],
    [-5, -5],
    [5, -5],
  ]);
});
test("3D path: walk crosses Start; search and jail travel directly", () => {
  assert.deepEqual(sceneMotionPath({ kind: "walk", from: 38, to: 2, steps: 4 }), [39, 0, 1, 2]);
  assert.deepEqual(sceneMotionPath({ kind: "search", from: 20, to: 0 }), [0]);
  assert.deepEqual(sceneMotionPath({ kind: "jail", from: 39, to: 10 }), [10]);
});
test("roll records cosmetic motion without duplicating salary", () => {
  let s = setup();
  p(s).pos = 38;
  s = apply(s, "p0", { type: "roll" }, 1000000, () => 0);
  assert.deepEqual(s.motions, [
    { seq: 1, playerId: "p0", from: 38, to: 0, kind: "walk", steps: 2 },
  ]);
  assert.equal(p(s).cash, 1150000);
  assert.deepEqual(s.lastRoll, { seq: 1, playerId: "p0", dice: [1, 1], total: 2 });
  assert.equal(s.rollSeq, 1);
});
test("dice animation reveals faces, then their sum, before movement", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => sceneDicePips(n).length), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([0, 899, 900, 1499, 1500, 2249, 2250].map((n) => sceneDiceStage(n)), [
    "rolling",
    "rolling",
    "values",
    "values",
    "sum",
    "sum",
    "done",
  ]);
  assert.deepEqual([0, 449, 450, 1049, 1050].map((n) => sceneDiceStage(n, true)), [
    "values",
    "values",
    "sum",
    "sum",
    "done",
  ]);
});
test("Search event carries no Start income", () => {
  let s = setup();
  s.phase = { type: "search", until: 1100000 };
  p(s).pos = 20;
  s.searchUsed = true;
  s = apply(s, "p0", { type: "search", tile: 0 }, 1000000, seeded(2));
  assert.equal(p(s).cash, 1000000);
  assert.deepEqual(s.motions, [
    { seq: 1, playerId: "p0", from: 20, to: 0, kind: "search", steps: 0 },
  ]);
});
test("third double records jail for the previous active player", () => {
  let s = setup();
  p(s).pos = 39;
  s.doubles = 2;
  s = apply(s, "p0", { type: "roll" }, 1000000, () => 0);
  assert.deepEqual(s.motions, [
    { seq: 1, playerId: "p0", from: 39, to: 10, kind: "jail", steps: 0 },
  ]);
  assert.notEqual(s.active, "p0");
  assert.equal(p(s).cash, 1000000);
});
test("legacy save gains bounded monotonic public motion history", () => {
  let s = setup();
  delete s.motions;
  for (let i = 0; i < 30; i++) {
    s.active = "p0";
    s.phase = { type: "search", until: 1100000 };
    s.searchUsed = true;
    s = apply(s, "p0", { type: "search", tile: 3 }, 1000000, seeded(i));
  }
  assert.equal(s.motions.length, 16);
  assert.equal(s.motions[0].seq, 15);
  assert.equal(s.motions.at(-1).seq, 30);
  assert.deepEqual(publicState(s, "p1").motions, s.motions);
  assert.equal(p(s).cash, 1000000);
});
