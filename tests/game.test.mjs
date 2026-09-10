import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  addPlayer,
  apply,
  tick,
  seeded,
  board,
  fee,
  monopolies,
  fountains,
  liquidation,
  buyout,
  publicState,
  assertGame,
} from "../public/engine.mjs";
import { GROUPS, BANKS, PAWNS } from "../public/data.mjs";
const NOW = 1000000;
function game(n = 3) {
  let s = createGame("test", 42);
  for (let i = 0; i < n; i++) {
    addPlayer(s, "p" + i, "Игрок " + i, BANKS[i].id);
    s.players.at(-1).ready = true;
  }
  s = apply(s, "p0", { type: "start" }, NOW, seeded(12));
  s.active = "p0";
  s.phase = { type: "manage", until: NOW + 45000 };
  return s;
}
const p = (s, id = "p0") => s.players.find((p) => p.id === id);
const cmd = (s, c, id = "p0", r = seeded(90)) => apply(s, id, c, NOW, r);
function debt(s, n, creditor = "p1") {
  s.phase = { type: "debt", amount: n, creditor, after: { type: "visit" }, until: NOW + 120000 };
  return s;
}
test("40 slots, 90 candidates, invariant geography and deterministic brand layout", () => {
  assert.equal(GROUPS.slice(3).flatMap((g) => g.brands).length, 90);
  for (let seed = 0; seed < 60; seed++) {
    const b = board(seed);
    assert.equal(b.length, 40);
    assert.deepEqual(
      b.filter((t) => t.type === "chance").map((t) => t.id),
      [13, 23, 33],
    );
    assert.deepEqual(
      b.filter((t) => t.type === "risk").map((t) => t.id),
      [37],
    );
    assert.equal(b[3].type, "rest");
    assert.equal(b.filter((t) => t.type === "property").length, 24);
    assert.equal(
      new Set(b.filter((t) => t.type === "property" && t.district > 0).map((t) => t.name)).size,
      18,
    );
    assert.equal(
      b.filter((t) => t.type === "fountain").reduce((s, t) => s + t.price, 0),
      800000,
    );
  }
  assert.deepEqual(board(42), board(42));
  assert.notDeepEqual(board(42), board(43));
});
test("six seats, unique banks, ready gate, no initial salary", () => {
  let s = createGame("x");
  for (let i = 0; i < 6; i++) addPlayer(s, "p" + i, "Кент", BANKS[i].id);
  assert.throws(() => addPlayer(s, "p6", "Друг", "sov"));
  assert.throws(() => cmd(s, { type: "start" }));
  assert.ok(s.players.every((p) => p.cash === 1000000));
  s = cmd(s, { type: "ready" });
  assert.equal(p(s).ready, true);
});
test("players choose unique pawns and the last ready player starts the game", () => {
  let s = createGame("lobby");
  addPlayer(s, "p0", "Первый", BANKS[0].id, PAWNS[0].id);
  addPlayer(s, "p1", "Второй", BANKS[1].id, PAWNS[1].id);
  assert.throws(() => addPlayer(s, "p2", "Третий", BANKS[2].id, PAWNS[1].id));
  s = apply(s, "p0", { type: "pawn", pawn: PAWNS[2].id }, NOW, seeded(4));
  assert.equal(p(s).pawn, PAWNS[2].id);
  s = apply(s, "p0", { type: "ready" }, NOW, seeded(4));
  assert.equal(s.status, "lobby");
  s = apply(s, "p1", { type: "ready" }, NOW, seeded(4));
  assert.equal(s.status, "playing");
  assert.equal(s.phase.type, "roll");
  assert.ok(s.active);
});
test("start crossing pays exactly once and search teleport pays nothing", () => {
  let s = game();
  s.phase = { type: "roll", until: NOW + 1 };
  p(s).pos = 38;
  const before = p(s).cash;
  s = cmd(s, { type: "roll" }, "p0", () => 0);
  assert.equal(p(s).pos, 0);
  assert.equal(p(s).cash, before + 150000);
  s.phase = { type: "search", until: NOW + 1 };
  p(s).pos = 20;
  s.searchUsed = true;
  s = cmd(s, { type: "search", tile: 0 });
  assert.equal(p(s).cash, before + 150000);
});
test("third double sends to jail without moving or salary", () => {
  let s = game();
  s.phase = { type: "roll", until: NOW + 1 };
  s.doubles = 2;
  p(s).pos = 39;
  s = cmd(s, { type: "roll" }, "p0", () => 0);
  assert.equal(p(s).pos, 10);
  assert.equal(p(s).jail, true);
  assert.equal(p(s).cash, 1000000);
  assert.notEqual(s.active, "p0");
});
test("rent examples and fountain auto-upgrade/downgrade", () => {
  let s = game();
  for (const i of [18, 19]) s.tiles[i].owner = "p0";
  s.tiles[19].level = 2;
  s.award = 19;
  assert.equal(fee(s, s.tiles[19]), 231000);
  for (const i of [38, 39]) s.tiles[i].owner = "p0";
  s.tiles[39].level = 3;
  s.award = 39;
  assert.equal(fee(s, s.tiles[39]), 744000);
  for (const [i, expected] of [
    [5, 20000],
    [15, 50000],
    [25, 100000],
  ]) {
    s.tiles[i].owner = "p0";
    assert.equal(fee(s, s.tiles[5]), expected);
  }
  s = cmd(s, { type: "sell", tile: 25 });
  assert.equal(fee(s, s.tiles[5]), 50000);
  assert.equal(p(s).cash, 1100000);
});
test("global award transfers, persists on building sale to player, returns to ceremony", () => {
  let s = game();
  s.tiles[1].owner = "p0";
  s.tiles[2].owner = "p1";
  s.award = 2;
  s.phase = { type: "award", until: NOW + 1 };
  s = cmd(s, { type: "award", tile: 1 });
  assert.equal(s.award, 1);
  assert.equal(fee(s, s.tiles[2]), 8000);
  s.phase = { type: "manage", until: NOW + 1 };
  s = cmd(s, { type: "trade", to: "p1", give: [1], take: [], pay: 0, receive: 0 });
  s = cmd(s, { type: "acceptTrade" }, "p1");
  assert.equal(s.award, 1);
  assert.equal(s.tiles[1].owner, "p1");
  s.active = "p1";
  s.phase = { type: "manage", until: NOW + 1 };
  s = cmd(s, { type: "sell", tile: 1 }, "p1");
  assert.equal(s.award, null);
});
test("award timeout leaves previous cup untouched", () => {
  let s = game();
  s.tiles[1].owner = "p1";
  s.award = 1;
  s.phase = { type: "award", until: NOW - 1 };
  s = tick(s, NOW, seeded(1));
  assert.equal(s.award, 1);
});
test("forced takeover pays old owner and keeps levels/cup", () => {
  let s = game();
  s.tiles[19].owner = "p1";
  s.tiles[19].level = 2;
  s.award = 19;
  p(s).cash = 2000000;
  s.phase = { type: "takeover", tile: 19, until: NOW + 1 };
  assert.equal(buyout(s.tiles[19]), 1120000);
  s = cmd(s, { type: "takeover" });
  assert.equal(p(s).cash, 880000);
  assert.equal(p(s, "p1").cash, 2120000);
  assert.equal(s.award, 19);
  assert.equal(s.tiles[19].level, 2);
  assert.equal(s.tiles[19].owner, "p0");
  s.phase = { type: "takeover", tile: 5, until: NOW + 1 };
  s.tiles[5].owner = "p1";
  s.takeoverUsed = false;
  assert.throws(() => cmd(s, { type: "takeover" }));
});
test("landing fee precedes takeover; voluntary overspend is atomic", () => {
  let s = game();
  p(s).pos = 17;
  s.tiles[19].owner = "p1";
  s.phase = { type: "roll", until: NOW + 1 };
  s = cmd(s, { type: "roll" }, "p0", () => 0);
  assert.equal(p(s).cash, 972000);
  assert.equal(s.phase.type, "takeover");
  p(s).cash = 100;
  const old = structuredClone(s);
  assert.throws(() => cmd(s, { type: "takeover" }));
  assert.deepEqual(s, old);
});
test("CB loan exact shortage, fee rounded up, no second loan", () => {
  let s = debt(game(), 300000);
  p(s).cash = 100000;
  s = cmd(s, { type: "loan", principal: 200000, total: 220000 });
  assert.equal(p(s).cash, 0);
  assert.equal(p(s).loan.total, 220000);
  assert.equal(p(s, "p1").cash, 1300000);
  const due = p(s).ownTurn + 5;
  assert.equal(p(s).loan.due, due);
  s = debt(s, 1000);
  assert.throws(() => cmd(s, { type: "loan", principal: 1000, total: 2000 }));
  s = debt(game(), 100001);
  p(s).cash = 0;
  s = cmd(s, { type: "loan", principal: 100001, total: 111001 });
  assert.equal(p(s).loan.fee, 11000);
});
test("loan cap, stale quote and refinancing rejected", () => {
  let s = debt(game(), 600000);
  p(s).cash = 0;
  assert.throws(() => cmd(s, { type: "loan", principal: 600000, total: 660000 }));
  s = debt(game(), 200000);
  p(s).cash = 0;
  assert.throws(() => cmd(s, { type: "loan", principal: 200000, total: 210000 }));
  s.phase.creditor = "CB";
  assert.throws(() => cmd(s, { type: "loan", principal: 200000, total: 220000 }));
});
test("loan maturity at turn start including jail and idempotent financial state", () => {
  let s = game(2);
  s.active = "p1";
  p(s).jail = true;
  p(s).ownTurn = 4;
  p(s).loan = { principal: 200000, fee: 20000, total: 220000, due: 5 };
  s = cmd(s, { type: "end" }, "p1");
  assert.equal(s.active, "p0");
  assert.equal(p(s).ownTurn, 5);
  assert.equal(p(s).loan, null);
  assert.equal(p(s).cash, 780000);
  assert.equal(s.phase.type, "jail");
});
test("rescue market is seller choice; partial proceeds plus CB credit", () => {
  let s = debt(game(), 300000);
  p(s).cash = 0;
  s.tiles[1].owner = "p0";
  s = cmd(s, { type: "rescueLot", ids: [1] });
  s = cmd(s, { type: "rescueOffer", cash: 50000, give: [] }, "p1");
  s = cmd(s, { type: "rescueOffer", cash: 60000, give: [] }, "p2");
  assert.equal(publicState(s, "p1").rescue.offers.length, 1);
  s = cmd(s, { type: "acceptRescue", bidder: "p1" });
  assert.equal(p(s).cash, 50000);
  assert.equal(s.phase.type, "debt");
  assert.equal(s.tiles[1].owner, "p1");
  assert.equal(s.rescue, null);
  s = cmd(s, { type: "loan", principal: 250000, total: 275000 });
  assert.equal(p(s).cash, 0);
  assert.equal(p(s).loan.total, 275000);
});
test("expired rescue offer rejected; manual selling cancels lot", () => {
  let s = debt(game(), 300000);
  p(s).cash = 0;
  s.tiles[1].owner = "p0";
  s = cmd(s, { type: "rescueLot", ids: [1] });
  s = cmd(s, { type: "rescueOffer", cash: 50000 }, "p1");
  assert.throws(() =>
    apply(s, "p0", { type: "acceptRescue", bidder: "p1" }, NOW + 31000, seeded(1)),
  );
  s = cmd(s, { type: "sell", tile: 1 });
  assert.equal(s.rescue, null);
  assert.equal(p(s).cash, 30000);
});
test("debt timeout liquidates without auto-credit or accepting offer", () => {
  let s = debt(game(), 30000);
  p(s).cash = 0;
  s.tiles[1].owner = "p0";
  s.phase.until = NOW - 1;
  s = tick(s, NOW, seeded(1));
  assert.equal(s.tiles[1].owner, null);
  assert.equal(p(s).loan, null);
  assert.equal(p(s).out, false);
  assert.equal(p(s).cash, 0);
});
test("bankruptcy with CB pays priority and does not gift surplus beyond current claim", () => {
  let s = debt(game(), 10000);
  p(s).cash = 500000;
  p(s).loan = { principal: 100000, fee: 10000, total: 110000, due: 9 };
  s = cmd(s, { type: "surrender" });
  assert.equal(p(s).out, true);
  assert.equal(p(s, "p1").cash, 1010000);
  assert.equal(p(s).cash, 0);
});
test("four color groups win, three do not; fountains separate", () => {
  let s = game();
  for (const i of [1, 2, 4, 6, 8, 9]) s.tiles[i].owner = "p0";
  s.tiles[5].owner = "p0";
  assert.equal(monopolies(s, "p0").length, 3);
  assert.equal(fountains(s, "p0"), 1);
  s = cmd(s, { type: "end" });
  assert.equal(s.status, "playing");
  s.active = "p0";
  s.tiles[11].owner = "p0";
  s.phase = { type: "purchase", tile: 12, until: NOW + 1 };
  s = cmd(s, { type: "buy" });
  assert.equal(s.status, "finished");
  assert.equal(s.winners[0].id, "p0");
});
test("fourth fountain wins only after current rescue obligation closes", () => {
  let s = debt(game(), 100000);
  p(s).cash = 0;
  for (const i of [5, 15, 25]) s.tiles[i].owner = "p0";
  s.tiles[1].owner = "p0";
  s.tiles[35].owner = "p1";
  s = cmd(s, { type: "rescueLot", ids: [1] });
  s = cmd(s, { type: "rescueOffer", cash: 50000, give: [35] }, "p1");
  s = cmd(s, { type: "acceptRescue", bidder: "p1" });
  assert.equal(s.status, "playing");
  assert.equal(fountains(s, "p0"), 4);
  s = cmd(s, { type: "loan", principal: 50000, total: 55000 });
  assert.equal(s.status, "finished");
});
test("sealed auction equal bids use turn order and never disclose opponent bid", () => {
  let s = game();
  s.phase = { type: "purchase", tile: 1, until: NOW + 1 };
  s = cmd(s, { type: "auction" });
  s = cmd(s, { type: "bid", amount: 30000 }, "p1");
  assert.equal(publicState(s, "p2").bids, undefined);
  assert.equal(publicState(s, "p2").myBid, null);
  s = cmd(s, { type: "bid", amount: 30000 }, "p0");
  s = cmd(s, { type: "bid", amount: 0 }, "p2");
  assert.equal(s.tiles[1].owner, "p0");
  assert.equal(p(s).cash, 970000);
});
test("no future cards in player projection; unauthorized turn is rejected", () => {
  let s = game();
  const out = publicState(s, "p1");
  assert.equal(out.chance, undefined);
  assert.equal(out.risk, undefined);
  assert.throws(() => cmd(s, { type: "end" }, "p1"));
});
test("seeded self-play exercises complete turn loops and invariant checks", () => {
  for (let seed = 0; seed < 12; seed++) {
    let s = game(2 + (seed % 5));
    const r = seeded(seed + 700);
    for (let i = 0; i < 1800 && s.status === "playing"; i++) {
      const p0 = p(s, s.active);
      let c;
      switch (s.phase.type) {
        case "roll":
          c = { type: "roll" };
          break;
        case "jail":
          c = { type: "jail", choice: "roll" };
          break;
        case "purchase":
          c = { type: p0.cash >= s.tiles[s.phase.tile].price + 20000 ? "buy" : "auction" };
          break;
        case "auction": {
          const q = s.players.find((p) => !p.out && !(p.id in s.bids));
          const price = s.tiles[s.phase.tile].price / 2;
          s = apply(
            s,
            q.id,
            { type: "bid", amount: q.cash >= price ? price : 0 },
            NOW + i * 100,
            r,
          );
          continue;
        }
        case "award":
          c = {
            type: "award",
            tile: s.tiles.find((t) => t.owner === s.active && t.type === "property").id,
          };
          break;
        case "search":
          c = { type: "search", tile: r(40) };
          break;
        case "takeover":
          c = { type: "skip" };
          break;
        case "manage": {
          const t = s.tiles.find(
            (t) => t.owner === s.active && t.type === "property" && t.level < 3,
          );
          c =
            !s.upgradeUsed && t && p0.cash > t.price / 2 + 100000
              ? { type: "upgrade", tile: t.id }
              : { type: "end" };
          break;
        }
        case "debt": {
          const gap = s.phase.amount - p0.cash;
          if (!p0.loan && gap <= 500000 && s.phase.creditor !== "CB")
            c = { type: "loan", principal: gap, total: gap + Math.ceil(gap / 10000) * 1000 };
          else {
            s = tick(s, s.phase.until + 1, r);
            assertGame(s);
            continue;
          }
          break;
        }
        default:
          throw Error(s.phase.type);
      }
      s = apply(s, s.active, c, NOW + i * 100, r);
      assertGame(s);
    }
    assert.ok(s.turn > 10 || s.status === "finished");
  }
});
