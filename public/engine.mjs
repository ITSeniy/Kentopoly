import { BANKS, PAWNS, GROUPS, PRICES, CHANCE, RISK } from "./data.mjs";
export const VERSION = "0.3.0-alpha";
export const money = (n) => "$" + Math.round(n).toLocaleString("ru-RU");
const ok = (v, msg) => {
  if (!v) throw Error(msg);
};
const shuffle = (a, r) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = r(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export function seeded(seed) {
  let x = seed >>> 0;
  return (n) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return Math.floor((x / 4294967296) * n);
  };
}
export const player = (s, id) => s.players.find((p) => p.id === id);
export const active = (s) => player(s, s.active);
export const assets = (s, id) => s.tiles.filter((t) => t.owner === id);
export const fountains = (s, id) => assets(s, id).filter((t) => t.type === "fountain").length;
export const monopolies = (s, id) =>
  GROUPS.filter(
    (g) =>
      s.tiles.filter((t) => t.group === g.id).length === 2 &&
      s.tiles.filter((t) => t.group === g.id).every((t) => t.owner === id),
  ).map((g) => g.id);
export function fee(s, t) {
  if (!t.owner) return 0;
  if (t.type === "fountain") return [0, 20000, 50000, 100000, 0][fountains(s, t.owner)];
  return (
    Math.ceil(
      (t.base *
        [1, 1.75, 2.75, 4][t.level] *
        (monopolies(s, t.owner).includes(t.group) ? 1.5 : 1) *
        (s.award === t.id ? 2 : 1)) /
        1000,
    ) * 1000
  );
}
export const buyout = (t) => 2 * (t.price + (t.level * t.price) / 2);
export const liquidation = (t) => t.price / 2 + (t.level * t.price) / 4;
export function available(s, id) {
  const p = player(s, id);
  let held = 0;
  if (s.phase.type === "auction") held = s.bids?.[id] || 0;
  for (const o of s.rescue?.offers || []) if (o.bidder === id) held += o.cash;
  return p.cash - held;
}
export function board(seed) {
  const r = seeded(seed);
  const tiles = Array.from({ length: 40 }, (_, id) => ({
    id,
    type: "rest",
    name: "Передышка",
    owner: null,
    level: 0,
    price: 0,
    base: 0,
    district: Math.floor(id / 10),
  }));
  for (let d = 0; d < 4; d++)
    for (let g = 0; g < 3; g++) {
      const def = GROUPS[d * 3 + g],
        names = d ? shuffle(def.brands, r).slice(0, 2) : def.brands;
      for (let k = 0; k < 2; k++) {
        const ix = g * 2 + k,
          id = d * 10 + [1, 2, 4, 6, 8, 9][ix];
        Object.assign(tiles[id], {
          type: "property",
          name: names[k],
          group: def.id,
          color: def.color,
          price: PRICES[d][ix] * 1000,
          base: PRICES[d][ix] * 100,
        });
      }
    }
  for (const [id, type, name] of [
    [0, "start", "Начало"],
    [10, "jail", "Тюрьма"],
    [20, "award", "2026 Awards"],
    [30, "search", "Поиск"],
    [13, "chance", "Chance"],
    [23, "chance", "Chance"],
    [33, "chance", "Chance"],
    [37, "risk", "Risk"],
  ])
    Object.assign(tiles[id], { type, name });
  for (let d = 0; d < 4; d++) {
    Object.assign(tiles[d * 10 + 5], {
      type: "fountain",
      name: ["У подъезда", "В атриуме", "У бизнес-центра", "Площадь капитала"][d],
      price: 200000,
    });
    if (d < 3)
      Object.assign(tiles[d * 10 + 7], {
        type: "tax",
        name: ["Коммуналка", "Сбор ТЦ", "Городской сбор"][d],
        tax: [30000, 50000, 75000][d],
      });
  }
  return tiles;
}
export function migrateTableLayout(s) {
  const layoutVersion = Number(s.layoutVersion) || 0;
  if (!Number.isSafeInteger(s.rollSeq) || s.rollSeq < 0) s.rollSeq = 0;
  if (!("lastRoll" in s)) s.lastRoll = null;
  if (layoutVersion >= 4) return s;
  if (layoutVersion < 3) {
    if (s.tiles?.[20]?.type === "search" && s.tiles?.[30]?.type === "award") {
      Object.assign(s.tiles[20], { type: "award", name: "2026 Awards" });
      Object.assign(s.tiles[30], { type: "search", name: "Поиск" });
      for (const p of s.players) p.pos = p.pos === 20 ? 30 : p.pos === 30 ? 20 : p.pos;
      s.motions = [];
    }
    for (const t of s.tiles || []) {
      const g = GROUPS.find((g) => g.id === t.group);
      if (g) t.color = g.color;
    }
  }
  const usedPawns = new Set();
  for (const p of s.players || []) {
    if (!PAWNS.some((pawn) => pawn.id === p.pawn) || usedPawns.has(p.pawn))
      p.pawn = PAWNS.find((pawn) => !usedPawns.has(pawn.id))?.id || PAWNS[0].id;
    usedPawns.add(p.pawn);
  }
  s.layoutVersion = 4;
  return s;
}
export function createGame(id, seed = 1234) {
  return {
    id,
    seed,
    version: 0,
    layoutVersion: 4,
    status: "lobby",
    players: [],
    host: null,
    tiles: board(seed),
    active: null,
    phase: { type: "lobby", until: 0 },
    award: null,
    log: [],
    turn: 0,
    doubles: 0,
    rollSeq: 0,
    lastRoll: null,
    extra: false,
    searchUsed: false,
    upgradeUsed: false,
    takeoverUsed: false,
    bids: {},
    trade: null,
    rescue: null,
    chance: [],
    risk: [],
    chanceDiscard: [],
    riskDiscard: [],
    winners: [],
  };
}
export function addPlayer(s, id, name, bank, pawn) {
  ok(s.status === "lobby", "Партия уже началась");
  ok(s.players.length < 6, "Все шесть мест заняты");
  name = String(name || "").trim();
  ok(name.length >= 1 && name.length <= 24, "Ник: от 1 до 24 символов");
  ok(
    BANKS.some((b) => b.id === bank),
    "Выберите банк",
  );
  ok(!s.players.some((p) => p.bank === bank), "Этот банк уже занят");
  pawn ||= PAWNS.find((x) => !s.players.some((p) => p.pawn === x.id))?.id;
  ok(PAWNS.some((x) => x.id === pawn), "Выберите фигурку");
  ok(!s.players.some((p) => p.pawn === pawn), "Эта фигурка уже занята");
  ok(!s.players.some((p) => p.id === id), "Место уже существует");
  s.players.push({
    id,
    name,
    bank,
    pawn,
    cash: 1000000,
    pos: 0,
    ready: false,
    out: false,
    jail: false,
    attempts: 0,
    release: false,
    loan: null,
    ownTurn: 0,
  });
  if (!s.host) s.host = id;
  s.version++;
  return s;
}
function log(s, text) {
  s.log.push({ n: (s.log.at(-1)?.n || 0) + 1, text });
  s.log = s.log.slice(-180);
}
function setPhase(s, type, data = {}, now = Date.now()) {
  s.phase = {
    type,
    ...data,
    until:
      now +
      ({
        roll: 30,
        jail: 30,
        purchase: 30,
        auction: 30,
        search: 20,
        award: 20,
        takeover: 20,
        manage: 45,
        debt: 120,
      }[type] || 30) *
        1000,
  };
}
function transfer(s, from, to, amount) {
  ok(Number.isSafeInteger(amount) && amount >= 0, "Некорректная сумма");
  const p = player(s, from);
  ok(p.cash >= amount, "Недостаточно денег");
  p.cash -= amount;
  if (to && player(s, to) && !player(s, to).out) player(s, to).cash += amount;
}
function win(s) {
  if (s.status !== "playing" || s.phase.type === "debt") return false;
  const live = s.players.filter((p) => !p.out);
  const wins = live.filter(
    (p) => fountains(s, p.id) === 4 || monopolies(s, p.id).length >= 4 || live.length === 1,
  );
  if (wins.length || !live.length) {
    s.status = "finished";
    s.winners = wins.map((p) => ({
      id: p.id,
      reasons: [
        ...(fountains(s, p.id) === 4 ? ["Четыре фонтана"] : []),
        ...(monopolies(s, p.id).length >= 4 ? ["Четыре монополии"] : []),
        ...(live.length === 1 ? ["Последний игрок"] : []),
      ],
    }));
    s.phase = { type: "finished", until: 0 };
    s.trade = null;
    s.rescue = null;
    s.bids = {};
    log(s, wins.length ? "Победа: " + wins.map((p) => p.name).join(" и ") : "Партия завершена");
    return true;
  }
  return false;
}
function finishVisit(s, now) {
  if (win(s)) return;
  if (s.extra && !active(s).jail) {
    s.extra = false;
    setPhase(s, "roll", {}, now);
  } else setPhase(s, "manage", {}, now);
}
function readyTurn(s, now) {
  const p = active(s);
  if (p.jail) setPhase(s, "jail", {}, now);
  else setPhase(s, "roll", {}, now);
}
function beginTurn(s, now) {
  s.turn++;
  s.doubles = 0;
  s.extra = false;
  s.searchUsed = false;
  s.upgradeUsed = false;
  s.takeoverUsed = false;
  s.trade = null;
  s.rescue = null;
  const p = active(s);
  p.ownTurn++;
  log(s, "Ход " + s.turn + " · " + p.name);
  if (p.loan && p.ownTurn >= p.loan.due) charge(s, p.loan.total, "CB", { type: "turnReady" }, now);
  else readyTurn(s, now);
}
function nextTurn(s, now) {
  if (win(s)) return;
  let i = s.players.findIndex((p) => p.id === s.active);
  do {
    i = (i + 1) % s.players.length;
  } while (s.players[i].out);
  s.active = s.players[i].id;
  beginTurn(s, now);
}
function after(s, a, now, r) {
  if (a.type === "takeover") {
    const t = s.tiles[a.tile];
    if (t.owner && t.owner !== s.active && !s.takeoverUsed) {
      setPhase(s, "takeover", { tile: t.id }, now);
      return;
    }
    finishVisit(s, now);
  } else if (a.type === "turnReady") readyTurn(s, now);
  else if (a.type === "jailRoll") {
    active(s).jail = false;
    active(s).attempts = 0;
    setPhase(s, "roll", {}, now);
  } else if (a.type === "jailMove") {
    active(s).jail = false;
    active(s).attempts = 0;
    move(s, a.distance, now, r);
  } else finishVisit(s, now);
}
function payDebt(s) {
  const d = s.phase,
    p = active(s);
  transfer(s, p.id, d.creditor === "CB" ? null : d.creditor, d.amount);
  if (d.creditor === "CB") p.loan = null;
  log(s, p.name + " оплатил " + money(d.amount) + (d.creditor === "CB" ? " · кредит ЦБ" : ""));
  s.rescue = null;
  return d.after;
}
function settle(s, now, r) {
  if (s.phase.type === "debt" && active(s).cash >= s.phase.amount) {
    const a = payDebt(s);
    setPhase(s, "settled", {}, now);
    if (!win(s)) after(s, a, now, r);
  }
}
function charge(s, amount, creditor, a, now, r) {
  const p = active(s);
  if (p.cash >= amount) {
    transfer(s, p.id, creditor === "CB" ? null : creditor, amount);
    if (creditor === "CB") p.loan = null;
    if (amount)
      log(
        s,
        p.name +
          " → " +
          (creditor === "CB" ? "ЦБ" : creditor ? player(s, creditor)?.name : "банк игры") +
          ": " +
          money(amount),
      );
    after(s, a, now, r);
  } else {
    setPhase(s, "debt", { amount, creditor, after: a }, now);
    s.trade = null;
    s.rescue = null;
    log(s, "Нужен план спасения: " + p.name + ", не хватает " + money(amount - p.cash));
  }
}
function recordMotion(s, playerId, from, to, kind, steps = 0) {
  if (!s.motions) s.motions = [];
  const seq = (s.motions.at(-1)?.seq || 0) + 1;
  s.motions.push({ seq, playerId, from, to, kind, steps });
  s.motions = s.motions.slice(-16);
}
function recordRoll(s, playerId, dice) {
  const seq = (s.rollSeq || 0) + 1;
  s.rollSeq = seq;
  s.dice = [...dice];
  s.lastRoll = { seq, playerId, dice: [...dice], total: dice[0] + dice[1] };
}
function goJail(s, now) {
  const p = active(s);
  recordMotion(s, p.id, p.pos, 10, "jail");
  p.pos = 10;
  p.jail = true;
  p.attempts = 0;
  s.extra = false;
  log(s, p.name + " отправляется в Тюрьму");
  nextTurn(s, now);
}
function draw(s, kind, now, r) {
  const deck = kind === "chance" ? CHANCE : RISK;
  if (!s[kind].length) {
    s[kind] = shuffle(s[kind + "Discard"], r);
    s[kind + "Discard"] = [];
  }
  ok(s[kind].length, "Колода пуста");
  const ix = s[kind].pop(),
    c = deck[ix];
  log(s, (kind === "chance" ? "Chance" : "Risk") + " · " + c.name);
  if (!c.release) s[kind + "Discard"].push(ix);
  if (c.jail) {
    goJail(s, now);
    return;
  }
  if (c.release) {
    active(s).release = true;
    finishVisit(s, now);
    return;
  }
  if (c.move !== undefined) {
    move(s, (c.move - active(s).pos + 40) % 40, now, r);
    return;
  }
  const cash = c.repair ? -assets(s, s.active).reduce((a, t) => a + t.level * 20000, 0) : c.cash;
  if (cash < 0) charge(s, -cash, null, { type: "visit" }, now, r);
  else {
    active(s).cash += cash || 0;
    log(s, "Банк игры → " + active(s).name + ": " + money(cash || 0));
    finishVisit(s, now);
  }
}
function land(s, now, r) {
  const t = s.tiles[active(s).pos];
  if (t.type === "property" || t.type === "fountain") {
    if (!t.owner) setPhase(s, "purchase", { tile: t.id }, now);
    else if (t.owner !== s.active)
      charge(
        s,
        fee(s, t),
        t.owner,
        { type: t.type === "property" ? "takeover" : "visit", tile: t.id },
        now,
        r,
      );
    else finishVisit(s, now);
  } else if (t.type === "tax") charge(s, t.tax, null, { type: "visit" }, now, r);
  else if (t.type === "search" && !s.searchUsed) {
    s.searchUsed = true;
    setPhase(s, "search", {}, now);
  } else if (t.type === "award" && assets(s, s.active).some((t) => t.type === "property"))
    setPhase(s, "award", {}, now);
  else if (t.type === "chance" || t.type === "risk") draw(s, t.type, now, r);
  else finishVisit(s, now);
}
function move(s, n, now, r) {
  const p = active(s);
  recordMotion(s, p.id, p.pos, (p.pos + n) % 40, "walk", n);
  if (p.pos + n >= 40) {
    p.cash += 150000;
    log(s, p.name + " прошёл Старт: +$150 000");
  }
  p.pos = (p.pos + n) % 40;
  log(s, p.name + " → " + s.tiles[p.pos].name);
  land(s, now, r);
}
function bankSell(s, t, levelsOnly = false) {
  const p = player(s, t.owner);
  ok(p, "Актив свободен");
  if (levelsOnly) {
    ok(t.level > 0, "Нет уровней");
    t.level--;
    p.cash += t.price / 4;
    log(s, p.name + " продал уровень · " + t.name);
  } else {
    p.cash += liquidation(t);
    log(s, p.name + " продал банку · " + t.name + " · " + money(liquidation(t)));
    if (s.award === t.id) s.award = null;
    t.owner = null;
    t.level = 0;
  }
}
function bankrupt(s, now) {
  const p = active(s),
    creditor = s.phase.type === "debt" ? s.phase.creditor : null;
  const own = assets(s, p.id);
  if (p.loan) {
    for (const t of own) bankSell(s, t);
    const cb = Math.min(p.cash, p.loan.total);
    p.cash -= cb;
    p.loan = null;
    if (creditor && creditor !== "CB")
      transfer(s, p.id, creditor, Math.min(p.cash, s.phase.amount || 0));
    p.cash = 0;
  } else if (creditor && creditor !== "CB" && player(s, creditor) && !player(s, creditor).out) {
    transfer(s, p.id, creditor, p.cash);
    for (const t of own) t.owner = creditor;
  } else {
    p.cash = 0;
    for (const t of own) {
      if (s.award === t.id) s.award = null;
      t.owner = null;
      t.level = 0;
    }
  }
  if (p.release) {
    s.chanceDiscard.push(10);
    p.release = false;
  }
  p.out = true;
  s.trade = null;
  s.rescue = null;
  s.bids = {};
  log(s, p.name + " выбыл из партии");
  setPhase(s, "settled", {}, now);
  if (!win(s)) nextTurn(s, now);
}
function auctionEnd(s, now) {
  const t = s.tiles[s.phase.tile];
  const order = [
    ...s.players.slice(s.players.findIndex((p) => p.id === s.active)),
    ...s.players.slice(
      0,
      s.players.findIndex((p) => p.id === s.active),
    ),
  ];
  const bidders = order
    .filter((p) => !p.out && (s.bids[p.id] || 0) > 0)
    .sort((a, b) => s.bids[b.id] - s.bids[a.id]);
  if (bidders.length) {
    const p = bidders[0],
      amount = s.bids[p.id];
    transfer(s, p.id, null, amount);
    t.owner = p.id;
    log(s, p.name + " выиграл аукцион " + t.name + " за " + money(amount));
  } else log(s, "Нет ставок · " + t.name);
  s.bids = {};
  finishVisit(s, now);
}
function validateAssets(s, ids, owner) {
  ok(
    Array.isArray(ids) && ids.length <= 28 && new Set(ids).size === ids.length,
    "Некорректный список активов",
  );
  for (const id of ids)
    ok(Number.isInteger(id) && s.tiles[id]?.owner === owner, "Владение изменилось");
}
function amount(n, allowZero = true) {
  ok(Number.isSafeInteger(n) && n >= (allowZero ? 0 : 1) && n <= 1000000000, "Некорректная сумма");
  return n;
}
function ownTurn(s, id) {
  ok(s.active === id, "Сейчас ход другого игрока");
}
function inPhase(s, ...types) {
  ok(types.includes(s.phase.type), "Это действие сейчас недоступно");
}
export function apply(source, id, cmd, now = Date.now(), r = (n) => Math.floor(Math.random() * n)) {
  const s = migrateTableLayout(structuredClone(source));
  const p = player(s, id);
  ok(p, "Место не найдено");
  ok(!p.out, "Вы уже выбыли");
  ok(cmd && typeof cmd.type === "string", "Нет команды");
  const c = cmd;
  if (s.status === "lobby") {
    if (c.type === "ready") {
      p.ready = !p.ready;
      if (p.ready && s.players.length >= 2 && s.players.every((q) => q.ready)) {
        s.status = "playing";
        s.players = shuffle(s.players, r);
        s.active = s.players[0].id;
        s.chance = shuffle(
          CHANCE.map((_, i) => i),
          r,
        );
        s.risk = shuffle(
          RISK.map((_, i) => i),
          r,
        );
        log(s, "Kentopoly · новая партия");
        beginTurn(s, now);
      }
    }
    else if (c.type === "bank") {
      ok(
        BANKS.some((b) => b.id === c.bank) &&
          !s.players.some((q) => q.id !== id && q.bank === c.bank),
        "Банк занят",
      );
      p.bank = c.bank;
      p.ready = false;
    } else if (c.type === "pawn") {
      ok(
        PAWNS.some((x) => x.id === c.pawn) &&
          !s.players.some((q) => q.id !== id && q.pawn === c.pawn),
        "Фигурка занята",
      );
      p.pawn = c.pawn;
      p.ready = false;
    } else if (c.type === "start") {
      ok(s.host === id, "Только создатель начинает игру");
      ok(
        s.players.length >= 2 && s.players.every((q) => q.ready),
        "Нужно минимум двое готовых игроков",
      );
      s.status = "playing";
      s.players = shuffle(s.players, r);
      s.active = s.players[0].id;
      s.chance = shuffle(
        CHANCE.map((_, i) => i),
        r,
      );
      s.risk = shuffle(
        RISK.map((_, i) => i),
        r,
      );
      log(s, "Kentopoly · новая партия");
      beginTurn(s, now);
    } else throw Error("Сначала начните игру");
    s.version++;
    return s;
  }
  ok(s.status === "playing", "Партия завершена");
  if (c.type === "bid") {
    inPhase(s, "auction");
    ok(!(id in s.bids), "Ставка уже принята");
    const a = amount(c.amount);
    ok(a === 0 || a >= s.tiles[s.phase.tile].price / 2, "Ставка ниже половины цены");
    ok(a % 1000 === 0 && a <= p.cash, "Неверная ставка");
    s.bids[id] = a;
    if (s.players.filter((q) => !q.out).every((q) => q.id in s.bids)) auctionEnd(s, now);
  } else if (c.type === "rescueOffer") {
    inPhase(s, "debt");
    ok(id !== s.active && s.rescue, "Нет открытого лота");
    const a = amount(c.cash, false);
    ok(a <= p.cash, "Недостаточно денег");
    const give = c.give || [];
    validateAssets(s, give, id);
    s.rescue.offers = s.rescue.offers.filter((o) => o.bidder !== id);
    s.rescue.offers.push({
      bidder: id,
      cash: a,
      give,
      until: Math.min(now + 30000, s.phase.until),
      lot: [...s.rescue.ids],
    });
  } else if (c.type === "withdrawOffer") {
    inPhase(s, "debt");
    ok(s.rescue, "Нет предложений");
    s.rescue.offers = s.rescue.offers.filter((o) => o.bidder !== id);
  } else if (c.type === "acceptTrade" || c.type === "rejectTrade") {
    inPhase(s, "manage");
    const o = s.trade;
    ok(o && o.to === id && o.until >= now, "Нет актуального предложения");
    if (c.type === "acceptTrade") {
      validateAssets(s, o.give, o.from);
      validateAssets(s, o.take, o.to);
      const a = player(s, o.from);
      ok(a.cash >= o.pay && p.cash >= o.receive, "Баланс изменился");
      a.cash += o.receive - o.pay;
      p.cash += o.pay - o.receive;
      for (const t of o.give) s.tiles[t].owner = id;
      for (const t of o.take) s.tiles[t].owner = a.id;
      log(s, "Обмен: " + a.name + " ↔ " + p.name);
    }
    s.trade = null;
    win(s);
  } else {
    ownTurn(s, id);
    switch (c.type) {
      case "roll": {
        inPhase(s, "roll");
        const d = [r(6) + 1, r(6) + 1];
        recordRoll(s, p.id, d);
        log(s, p.name + " бросает " + d[0] + " + " + d[1]);
        if (d[0] === d[1]) s.doubles++;
        else s.doubles = 0;
        if (s.doubles === 3) goJail(s, now);
        else {
          s.extra = d[0] === d[1];
          move(s, d[0] + d[1], now, r);
        }
        break;
      }
      case "jail": {
        inPhase(s, "jail");
        if (c.choice === "pay") charge(s, 50000, null, { type: "jailRoll" }, now, r);
        else if (c.choice === "card") {
          ok(p.release, "Нет карты");
          p.release = false;
          s.chanceDiscard.push(10);
          p.jail = false;
          p.attempts = 0;
          setPhase(s, "roll", {}, now);
        } else {
          const d = [r(6) + 1, r(6) + 1];
          recordRoll(s, p.id, d);
          p.attempts++;
          s.extra = false;
          if (d[0] === d[1]) {
            p.jail = false;
            p.attempts = 0;
            move(s, d[0] + d[1], now, r);
          } else if (p.attempts >= 3)
            charge(s, 50000, null, { type: "jailMove", distance: d[0] + d[1] }, now, r);
          else setPhase(s, "manage", {}, now);
        }
        break;
      }
      case "buy": {
        inPhase(s, "purchase");
        const t = s.tiles[s.phase.tile];
        ok(!t.owner, "Объект занят");
        transfer(s, id, null, t.price);
        t.owner = id;
        log(s, p.name + " купил " + t.name + " · " + money(t.price));
        finishVisit(s, now);
        break;
      }
      case "auction":
        inPhase(s, "purchase");
        s.bids = {};
        setPhase(s, "auction", { tile: s.phase.tile }, now);
        log(s, "Открыт аукцион · " + s.tiles[s.phase.tile].name);
        break;
      case "search": {
        inPhase(s, "search");
        ok(Number.isInteger(c.tile) && c.tile >= 0 && c.tile < 40, "Выберите клетку");
        recordMotion(s, p.id, p.pos, c.tile, "search");
        p.pos = c.tile;
        log(s, "Поиск → " + s.tiles[c.tile].name);
        if (s.tiles[c.tile].type === "search") finishVisit(s, now);
        else land(s, now, r);
        break;
      }
      case "award": {
        inPhase(s, "award");
        const t = s.tiles[c.tile];
        ok(t?.owner === id && t.type === "property", "Нужно своё здание");
        s.award = t.id;
        log(s, "Единственный Awards → " + t.name + " (" + p.name + ")");
        finishVisit(s, now);
        break;
      }
      case "takeover": {
        inPhase(s, "takeover");
        ok(!s.takeoverUsed, "Лимит выкупа");
        const t = s.tiles[s.phase.tile];
        ok(t.type === "property" && t.owner && t.owner !== id, "Нельзя выкупить");
        transfer(s, id, t.owner, buyout(t));
        log(s, p.name + " выкупил " + t.name + " · " + money(buyout(t)));
        t.owner = id;
        s.takeoverUsed = true;
        finishVisit(s, now);
        break;
      }
      case "skip":
        inPhase(s, "search", "award", "takeover");
        finishVisit(s, now);
        break;
      case "upgrade": {
        inPhase(s, "manage");
        const t = s.tiles[c.tile];
        ok(
          !s.upgradeUsed && t?.owner === id && t.type === "property" && t.level < 3,
          "Улучшение недоступно",
        );
        transfer(s, id, null, t.price / 2);
        t.level++;
        s.upgradeUsed = true;
        s.trade = null;
        log(s, "Уровень " + t.level + " · " + t.name);
        break;
      }
      case "sell": {
        inPhase(s, "manage", "debt");
        const t = s.tiles[c.tile];
        ok(t?.owner === id, "Это не ваш актив");
        s.trade = null;
        if (s.rescue?.ids.includes(t.id)) s.rescue = null;
        bankSell(s, t, !!c.levelOnly);
        if (s.phase.type === "debt") settle(s, now, r);
        else win(s);
        break;
      }
      case "rescueLot":
        inPhase(s, "debt");
        validateAssets(s, c.ids, id);
        ok(c.ids.length, "Выберите имущество");
        s.rescue = { ids: c.ids, offers: [] };
        log(s, p.name + " выставил имущество для спасения");
        break;
      case "cancelLot":
        inPhase(s, "debt");
        s.rescue = null;
        break;
      case "acceptRescue": {
        inPhase(s, "debt");
        const o = s.rescue?.offers.find((o) => o.bidder === c.bidder && o.until >= now);
        ok(o, "Предложение истекло");
        validateAssets(s, o.lot, id);
        validateAssets(s, o.give, o.bidder);
        transfer(s, o.bidder, id, o.cash);
        for (const t of o.lot) s.tiles[t].owner = o.bidder;
        for (const t of o.give) s.tiles[t].owner = id;
        log(s, "Спасательная сделка: " + p.name + " получил " + money(o.cash));
        s.rescue = null;
        settle(s, now, r);
        break;
      }
      case "loan": {
        inPhase(s, "debt");
        ok(!p.loan && s.phase.creditor !== "CB", "Второй кредит и рефинансирование запрещены");
        const principal = s.phase.amount - p.cash;
        ok(principal > 0 && principal <= 500000, "Кредит доступен при нехватке до $500 000");
        const fixedFee = Math.ceil(principal / 10 / 1000) * 1000;
        ok(
          c.principal === principal && c.total === principal + fixedFee,
          "Условия изменились — подтвердите заново",
        );
        p.loan = { principal, fee: fixedFee, total: principal + fixedFee, due: p.ownTurn + 5 };
        p.cash += principal;
        log(
          s,
          "Кредит ЦБ: " +
            p.name +
            " · вернуть " +
            money(p.loan.total) +
            " в свой ход " +
            p.loan.due,
        );
        settle(s, now, r);
        break;
      }
      case "repay":
        inPhase(s, "manage");
        ok(p.loan, "Нет кредита");
        transfer(s, id, null, p.loan.total);
        log(s, p.name + " погасил кредит ЦБ");
        p.loan = null;
        break;
      case "trade": {
        inPhase(s, "manage");
        ok(!s.trade, "Сначала отмените открытое предложение");
        const q = player(s, c.to);
        ok(q && !q.out && q.id !== id, "Нужен другой игрок");
        validateAssets(s, c.give || [], id);
        validateAssets(s, c.take || [], q.id);
        amount(c.pay || 0);
        amount(c.receive || 0);
        ok(p.cash >= (c.pay || 0) && q.cash >= (c.receive || 0), "Недостаточно денег");
        s.trade = {
          from: id,
          to: q.id,
          give: c.give || [],
          take: c.take || [],
          pay: c.pay || 0,
          receive: c.receive || 0,
          until: Math.min(now + 20000, s.phase.until),
        };
        break;
      }
      case "cancelTrade":
        inPhase(s, "manage");
        s.trade = null;
        break;
      case "end":
        inPhase(s, "manage");
        nextTurn(s, now);
        break;
      case "surrender":
        inPhase(s, "manage", "roll", "jail", "debt");
        bankrupt(s, now);
        break;
      default:
        throw Error("Неизвестная команда");
    }
  }
  s.version++;
  assertGame(s);
  return s;
}
export function tick(source, now, r) {
  let s = migrateTableLayout(structuredClone(source)),
    changed = false;
  if (s.trade && s.trade.until <= now) {
    s.trade = null;
    changed = true;
  }
  if (s.rescue) {
    const n = s.rescue.offers.length;
    s.rescue.offers = s.rescue.offers.filter((o) => o.until > now);
    changed ||= n !== s.rescue.offers.length;
  }
  if (s.status === "playing" && s.phase.until <= now) {
    const id = s.active,
      t = s.phase.type;
    if (t === "auction") {
      auctionEnd(s, now);
      changed = true;
    } else if (t === "debt") {
      const p = active(s);
      if (p.cash + assets(s, id).reduce((v, t) => v + liquidation(t), 0) < s.phase.amount)
        bankrupt(s, now);
      else {
        for (const a of assets(s, id).sort((a, b) => a.id - b.id)) {
          while (a.level && p.cash < s.phase.amount) bankSell(s, a, true);
        }
        for (const a of assets(s, id).sort(
          (a, b) => (a.type === "fountain") - (b.type === "fountain") || a.price - b.price,
        )) {
          if (p.cash >= s.phase.amount) break;
          bankSell(s, a);
        }
        settle(s, now, r);
      }
      changed = true;
    } else {
      const map = {
        roll: { type: "roll" },
        jail: { type: "jail", choice: "roll" },
        purchase: { type: "auction" },
        search: { type: "skip" },
        award: { type: "skip" },
        takeover: { type: "skip" },
        manage: { type: "end" },
      };
      if (map[t]) {
        s = apply(s, id, map[t], now, r);
        changed = true;
      }
    }
  }
  if (changed) {
    s.version++;
    assertGame(s);
    return s;
  }
  return null;
}
export function assertGame(s) {
  ok(s.players.length <= 6, "Лимит мест");
  ok(new Set(s.players.map((p) => p.bank)).size === s.players.length, "Банки повторяются");
  ok(new Set(s.players.map((p) => p.pawn)).size === s.players.length, "Фигурки повторяются");
  ok(s.tiles.length === 40, "Поле");
  for (const p of s.players) {
    ok(Number.isSafeInteger(p.cash) && p.cash >= 0, "Отрицательные наличные");
    if (p.loan) ok(p.loan.total === p.loan.principal + p.loan.fee, "Договор");
  }
  for (const t of s.tiles) {
    ok(Number.isInteger(t.level) && t.level >= 0 && t.level <= 3, "Уровень");
    ok(!t.owner || (player(s, t.owner) && !player(s, t.owner).out), "Владелец");
    if (t.type === "fountain") ok(t.price === 200000 && t.level === 0, "Фонтан");
  }
  ok(
    s.award === null || (s.tiles[s.award]?.type === "property" && s.tiles[s.award].owner),
    "Единственная награда",
  );
  return true;
}
export function publicState(s, id) {
  const o = migrateTableLayout(structuredClone(s));
  delete o.chance;
  delete o.risk;
  delete o.chanceDiscard;
  delete o.riskDiscard;
  if (o.phase.type === "auction") {
    o.bidCount = Object.keys(o.bids).length;
    o.myBid = o.bids[id] ?? null;
  }
  delete o.bids;
  if (o.trade && o.trade.from !== id && o.trade.to !== id) o.trade = null;
  if (o.rescue && s.active !== id) o.rescue.offers = o.rescue.offers.filter((a) => a.bidder === id);
  o.myAvailable = player(s, id) ? available(s, id) : 0;
  return o;
}
