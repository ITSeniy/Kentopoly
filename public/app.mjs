import { createBoardScene } from "./scene.mjs";
import { BANKS, PAWNS, GROUPS, DISTRICTS } from "./data.mjs";
import {
  createGame,
  migrateTableLayout,
  addPlayer,
  apply,
  tick,
  publicState,
  active,
  player,
  assets,
  monopolies,
  fountains,
  fee,
  buyout,
  liquidation,
  money,
} from "./engine.mjs";
let boardScene = null,
  assetOpen = false,
  historyOffset = 0,
  sceneError = "",
  followState = true;
const STANDALONE = !!window.KENTOPOLY_STANDALONE;
const root = document.querySelector("#app"),
  modalRoot = document.querySelector("#modal-root");
let local = STANDALONE,
  state = null,
  full = null,
  me = null,
  selected = 0,
  stream = null,
  connected = false,
  busy = false,
  toastTimer,
  confirmCommand = null,
  screen = "home",
  joinToken = new URLSearchParams(location.search).get("join") || "",
  homeTab = joinToken ? "join" : "create";
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const rng = (n) => {
  const max = Math.floor(4294967296 / n) * n;
  let v;
  do {
    v = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (v >= max);
  return v % n;
};
const bank = (p) => BANKS.find((b) => b.id === p?.bank) || BANKS[0];
const pawn = (p) => PAWNS.find((x) => x.id === p?.pawn) || PAWNS[0];
const chip = (p) =>
  `<span class="bankchip" style="--bank:${bank(p).color};color:${bank(p).id === "tbank" ? "#242b32" : "#fff"}" aria-label="${e(bank(p).name)}">${e(bank(p).mark)}</span>`;
const pawnChip = (p) =>
  `<span class="pawnchip" aria-label="Фигурка: ${e(pawn(p).name)}">${e(pawn(p).mark)}</span>`;
const btn = (action, text, primary = false, disabled = false, attrs = "") => {
  const extra = attrs.match(/class="([^"]*)"/)?.[1] || "";
  attrs = attrs.replace(/class="[^"]*"/, "");
  return `<button data-action="${action}" class="${primary ? "primary" : ""} ${extra}" ${disabled ? "disabled" : ""} ${attrs}>${text}</button>`;
};
function toast(text) {
  clearTimeout(toastTimer);
  document.querySelector("#toast")?.remove();
  const x = document.createElement("div");
  x.id = "toast";
  x.className = "toast";
  x.setAttribute("role", "status");
  x.textContent = text;
  document.body.append(x);
  toastTimer = setTimeout(() => x.remove(), 4500);
}
function banksOptions(value, exclude = []) {
  return BANKS.map(
    (b) =>
      `<option value="${b.id}" ${b.id === value ? "selected" : ""} ${exclude.includes(b.id) ? "disabled" : ""}>${e(b.name)}${exclude.includes(b.id) ? " · занят" : ""}</option>`,
  ).join("");
}
function choiceGrid(items, value, exclude, action, kind) {
  return `<div class="choice-grid ${kind}-choices">${items
    .map((item) => {
      const blocked = exclude.includes(item.id),
        chosen = item.id === value;
      return `<button type="button" data-action="${action}" data-value="${item.id}" class="choice-card ${chosen ? "chosen" : ""}" ${blocked ? "disabled" : ""} aria-pressed="${chosen}">${kind === "bank" ? `<i style="--choice:${item.color}">${e(item.mark)}</i>` : `<i>${e(item.mark)}</i>`}<span>${e(item.name)}</span>${blocked ? "<small>занято</small>" : ""}</button>`;
    })
    .join("")}</div>`;
}
function home() {
  return `<main class="landing"><section class="intro"><div class="eyebrow">Дружеский капитализм</div><h1>От однушки<br>до своей империи.</h1><p>Покупай знакомые бренды, договаривайся с кентами и собери четыре фонтана. Или четыре монополии.</p></section><section class="card setup-card"><div class="setup-step">Настрой место за столом</div><h2>${local ? "Собрать кентов за экраном" : "Собрать свой стол"}</h2><p class="muted smalltext">${local ? "Выбери своё место. Остальные фигурки распределятся между игроками за этим экраном." : "Выбери банк и отдельную фигурку. В лобби выбор можно изменить до готовности."}</p>${!local ? `<div class="tabs">${btn("tab-create", "Создать", homeTab === "create")}${btn("tab-join", "По ссылке", homeTab === "join")}</div>` : ""}<label for="nickname">Твой ник</label><input id="nickname" maxlength="24" placeholder="Например, Panty" value="Кент"><input id="bank-choice" type="hidden" value="sber"><input id="pawn-choice" type="hidden" value="classic"><label>Выбери банк</label>${choiceGrid(BANKS, "sber", [], "home-bank", "bank")}<label>Выбери фигурку</label>${choiceGrid(PAWNS, "classic", [], "home-pawn", "pawn")}${local ? `<label for="local-count">Сколько игроков</label><select id="local-count">${[2, 3, 4, 5, 6].map((n) => `<option ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select><div class="notice">Это не боты: передавай управление по очереди. Для игры с разных устройств нужен сервер.</div><div class="stack">${btn("start-local", "Начать локальную партию →", true)}${full ? btn("resume-local", "Продолжить сохранённую") : ""}</div>` : `${homeTab === "join" ? '<label for="invite-input">Ссылка-приглашение</label><input id="invite-input" placeholder="Вставь ссылку от друга" value="' + e(joinToken ? location.origin + "/?join=" + joinToken : "") + '">' : ""}<div class="below">${btn(homeTab === "create" ? "create-online" : "join-online", homeTab === "create" ? "Создать комнату →" : "Зайти за стол →", true, false, 'class="wide primary"')}</div><div class="divider"></div>${btn("switch-local", "Попробовать на одном экране", false, false, 'class="wide"')}`}</section></main>`;
}
function lobby() {
  const p = player(state, me),
    inv = joinToken ? location.origin + location.pathname + "?join=" + joinToken : "",
    takenBanks = state.players.filter((q) => q.id !== me).map((q) => q.bank),
    takenPawns = state.players.filter((q) => q.id !== me).map((q) => q.pawn),
    readyCount = state.players.filter((q) => q.ready).length;
  return `<main class="lobby"><section class="card lobby-main"><div class="eyebrow">До первого броска</div><div class="lobby-heading"><h2>Твой стол · ${state.players.length}/6</h2><span>${readyCount}/${state.players.length} готовы</span></div><div class="seat-list">${state.players.map((q) => `<div class="playerline ${q.ready ? "is-ready" : ""}">${pawnChip(q)}${chip(q)}<div class="grow"><strong>${e(q.name)} ${q.id === me ? "· ты" : ""}</strong><span class="muted smalltext">${e(pawn(q).name)} · ${e(bank(q).name)}</span></div><span class="badge">${q.ready ? "Готов ✓" : "Выбирает"}</span></div>`).join("")}</div><div class="choice-section"><label>Твой банк</label>${choiceGrid(BANKS, p.bank, takenBanks, "lobby-bank", "bank")}<label>Твоя фигурка</label>${choiceGrid(PAWNS, p.pawn, takenPawns, "lobby-pawn", "pawn")}</div><div class="notice auto-start">Когда минимум два игрока нажмут «Готово», партия начнётся автоматически.</div>${btn("ready", p.ready ? "Готово ✓ · изменить выбор" : "Готово", !p.ready, false, 'class="wide ready-button"')}</section><section class="card lobby-invite"><h2>Пригласи друзей</h2><p class="muted">Отправь приватную ссылку — регистрация не нужна.</p><div class="invite below">${e(inv || "Получаем приглашение…")}</div><div class="below">${btn("copy-invite", "Скопировать ссылку", true, false, 'class="wide"')}</div><div class="divider"></div><div class="metricrow"><span>Начальный капитал</span><strong>$1 000 000</strong></div><div class="metricrow"><span>Выплата за Старт</span><strong>$150 000</strong></div><div class="metricrow"><span>Фонтан</span><strong>$200 000</strong></div></section></main>`;
}
const diceHTML = (val) => {
  const positions = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  }[val] || [4];
  return `<div class="die" aria-label="Кубик: ${val || 1}">${Array.from({ length: 9 }, (_, i) => `<i class="pip ${positions.includes(i) ? "" : "off"}"></i>`).join("")}</div>`;
};
function assetCard() {
  const t = state.tiles[selected],
    own = player(state, t.owner),
    isMine = t.owner === me && me === state.active,
    canManage = state.phase.type === "manage",
    debt = state.phase.type === "debt";
  const g = GROUPS.find((g) => g.id === t.group);
  return `<section class="card"><div class="eyebrow">Клетка ${t.id} · ${e(DISTRICTS[t.district])}</div><div class="selection-title" style="--group:${t.color || "var(--blue)"};margin-top:12px"><h2>${e(t.name)}</h2><p class="smalltext muted">${e(g?.name || (t.type === "fountain" ? "Коллекция фонтанов" : t.type === "risk" ? "Колода больших колебаний" : "Специальная клетка"))}</p></div>${t.price ? `<div class="bigmoney">${money(t.price)}</div><div class="metricrow"><span>Владелец</span><strong>${own ? e(own.name) : "Банк игры"}</strong></div><div class="metricrow"><span>Комиссия сейчас</span><strong>${money(fee(state, t))}</strong></div>${t.type === "property" ? `<div class="metricrow"><span>Уровень</span><strong>${t.level}/3${state.award === t.id ? " · ★ ×2" : ""}</strong></div><div class="metricrow"><span>Следующий уровень</span><strong>${t.level < 3 ? money(t.price / 2) : "Максимум"}</strong></div>` : `<div class="metricrow"><span>Автоступень</span><strong>${own ? fountains(state, own.id) : 0} / 4</strong></div>`}${own ? `<div class="metricrow"><span>Продать банку</span><strong>${money(liquidation(t))}</strong></div>` : ""}${isMine && (canManage || debt) ? `<div class="stack below">${canManage && t.type === "property" ? btn("upgrade", "Улучшить", true, state.upgradeUsed || t.level >= 3 || player(state, me).cash < t.price / 2, `data-id="${t.id}"`) : ""}${t.level ? btn("sell-level", "Продать уровень · " + money(t.price / 4), false, false, `data-id="${t.id}"`) : ""}${btn("sell-property", "Продать объект · " + money(liquidation(t)), false, false, `data-id="${t.id}"`)}</div>` : ""}` : `<p class="muted smalltext below">${{ start: "При обычном прохождении +$150 000. Поиск не платит за телепорт.", jail: "Обычная остановка — визит. При аресте: дубль, пропуск или $50 000.", search: "Выбери любую клетку. Только один Поиск за полный ход.", award: "Один кубок на партию. Прикрепи к своему бизнесу: комиссия ×2.", chance: "Вытяни карту небольшого события, перемещения или Тюрьмы.", risk: "Карта может дать или забрать от $50 000 до $350 000.", tax: "Обязательный платёж банку игры: " + money(t.tax || 0) + ".", rest: "Нейтральная клетка. Можно выдохнуть." }[t.type]}</p>`}${state.phase.type === "search" && me === state.active ? `<div class="below">${btn("go-selected", "Переместиться сюда", true)}</div>` : ""}${state.phase.type === "award" && me === state.active && t.owner === me && t.type === "property" ? `<div class="below">${btn("award-selected", "Передать кубок сюда", true)}</div>` : ""}</section>`;
}
function actionPanel() {
  const a = active(state),
    p = player(state, me),
    my = me === state.active,
    ph = state.phase,
    t = state.tiles[ph.tile],
    enabled = local || connected;
  let title = "Твой ход",
    desc = "",
    body = "";
  if (state.status === "finished")
    return `<section class="card"><h2>Партия завершена</h2><p>Журнал и итоговое владение остаются на поле.</p>${local ? '<div class="below">' + btn("new-local", "Новая локальная партия", true) + "</div>" : ""}</section>`;
  if (ph.type === "auction") {
    title = "Аукцион";
    desc =
      e(t.name) +
      " · минимум " +
      money(t.price / 2) +
      ". Одна скрытая ставка. Порядок хода решает ничью.";
    body =
      state.myBid !== null
        ? `<div class="notice">Твоя ставка: ${money(state.myBid)}. Ответили ${state.bidCount}/${state.players.filter((p) => !p.out).length}.</div>`
        : `<label for="bid-cash">Ставка в долларах</label><input id="bid-cash" type="number" min="${t.price / 2}" step="1000" value="${t.price / 2}"><div class="actions below">${btn("bid", "Подать ставку", true)}${btn("pass-bid", "Пас")}</div>`;
  } else if (ph.type === "debt") {
    title = "План спасения";
    const gap = ph.amount - a.cash;
    desc =
      e(a.name) + " должен " + money(ph.amount) + ". Не хватает " + money(Math.max(0, gap)) + ".";
    if (my) {
      body = `<div class="stack">${btn("rescue-lot", "1. Аукцион / предложения", true, assets(state, me).length === 0)}${btn("loan", "2. Кредит ЦБ", false, !!p.loan || gap > 500000)}${btn("liquidate", "3. Продать имущество", false, assets(state, me).length === 0)}</div><p class="smalltext muted below">Общий таймер не продлевается. Кредит только по явному согласию.</p>`;
      if (state.rescue)
        body += `<div class="notice">Лот: ${state.rescue.ids.map((id) => e(state.tiles[id].name)).join(", ")}</div>${state.rescue.offers.map((o) => `<div class="offer"><strong>${e(player(state, o.bidder).name)}: ${money(o.cash)}</strong>${o.give.length ? "<p>Имущество: " + o.give.map((id) => e(state.tiles[id].name)).join(", ") + "</p>" : ""}<div class="below">${btn("accept-rescue", "Принять", true, false, `data-bidder="${e(o.bidder)}"`)}</div></div>`).join("")}${btn("cancel-lot", "Снять лот")}`;
    } else
      body = state.rescue
        ? `<div class="notice">Продаётся: ${state.rescue.ids.map((id) => e(state.tiles[id].name)).join(", ")}</div>${btn("make-rescue-offer", "Предложить сделку", true)}${state.rescue.offers.length ? '<p class="smalltext below">Твоё предложение отправлено.</p>' + btn("withdraw-offer", "Отозвать") : ""}`
        : '<p class="muted smalltext">Должник выбирает, как получить деньги. Когда появится лот, можно предложить сделку.</p>';
  } else if (!my) {
    title = "Ход " + e(a.name);
    desc = "Сейчас решения принимает другой игрок.";
    body = '<p class="smalltext muted">Можно изучать поле и свой портфель.</p>';
  } else
    switch (ph.type) {
      case "roll":
        title = "Бросаем кубики?";
        desc = "Твой банк — " + e(bank(p).name) + ". Выплата за Старт: $150 000.";
        body = btn("roll", "Бросить два кубика", true, false, 'class="primary wide"');
        break;
      case "purchase":
        title = "Свободный актив";
        desc = e(t.name) + " · " + money(t.price) + ". Купить или выставить на аукцион для всех.";
        body = `<div class="stack">${btn("buy", "Купить за " + money(t.price), true, p.cash < t.price)}${btn("auction", "На аукцион")}</div>`;
        break;
      case "takeover":
        title = "Можно выкупить";
        desc =
          "Комиссия уже оплачена. " +
          e(t.name) +
          " можно принудительно выкупить у " +
          e(player(state, t.owner)?.name) +
          ".";
        body = `<div class="stack">${btn("takeover", "Выкупить · " + money(buyout(t)), true, p.cash < buyout(t))}${btn("skip", "Оставить владельцу")}</div>`;
        break;
      case "search":
        title = "Куда отправимся?";
        desc =
          "Выбери любую клетку на поле, затем подтверди перемещение. Телепорт не даёт зарплату.";
        body = `<label for="search-target">Клетка назначения</label><select id="search-target">${state.tiles.map((t) => `<option value="${t.id}" ${selected === t.id ? "selected" : ""}>${t.id} · ${e(t.name)}</option>`).join("")}</select><div class="actions below">${btn("go-selected", "Переместиться", true)}${btn("skip", "Пропустить")}</div>`;
        break;
      case "award":
        title = "2026 Awards";
        desc = "Единственный кубок даёт ×2 комиссии. На прежнем здании бонус исчезнет.";
        body = `<label for="award-target">Твой бизнес</label><select id="award-target">${assets(
          state,
          me,
        )
          .filter((t) => t.type === "property")
          .map((t) => `<option value="${t.id}">${e(t.name)} · ${money(fee(state, t))}</option>`)
          .join(
            "",
          )}</select><div class="actions below">${btn("claim-award", "Передать кубок", true)}${btn("skip", "Отказаться")}</div>`;
        break;
      case "jail":
        title = "В Тюрьме";
        desc =
          "Попытка " + (p.attempts + 1) + "/3. Дубль освободит, но не даст дополнительный бросок.";
        body = `<div class="stack">${btn("jail-roll", "Попытаться выбросить дубль", true)}${btn("jail-pay", "Выйти за $50 000")}${btn("jail-card", "Использовать пропуск", false, !p.release)}</div>`;
        break;
      case "manage":
        title = "Управляй капиталом";
        desc = "Одно улучшение за полный ход. Выбери свой бизнес на поле или предложи обмен.";
        body = `<div class="stack">${btn("end", "Завершить ход →", true)}${btn("trade", "Предложить обмен")}${btn("liquidate", "Моё имущество", false, !assets(state, me).length)}${p.loan ? btn("repay", "Погасить ЦБ · " + money(p.loan.total), false, p.cash < p.loan.total) : ""}</div>`;
        break;
    }
  if (state.trade && state.trade.to === me) {
    const o = state.trade;
    body += `<div class="offer"><strong>Предложение от ${e(player(state, o.from).name)}</strong><p>Получишь: ${money(o.pay)}${o.give.map((id) => " · " + e(state.tiles[id].name)).join("")}</p><p>Отдашь: ${money(o.receive)}${o.take.map((id) => " · " + e(state.tiles[id].name)).join("")}</p><div class="actions">${btn("accept-trade", "Принять", true)}${btn("reject-trade", "Отклонить")}</div></div>`;
  }
  if (state.trade?.from === me)
    body += `<div class="notice">Предложение обмена ожидает ответа.</div>${btn("cancel-trade", "Отменить обмен")}`;
  const phaseBadge =
    {
      roll: ["🎲", "Бросок"],
      purchase: ["◆", "Сделка"],
      auction: ["⚒", "Аукцион"],
      takeover: ["⚡", "Выкуп"],
      search: ["⌖", "Маршрут"],
      award: ["★", "Awards"],
      jail: ["▦", "Тюрьма"],
      debt: ["!", "Спасение"],
      manage: ["▣", "Управление"],
    }[ph.type] || ["●", "Ход"];
  return `<section class="card action-card phase-${ph.type}"><div class="phase-kicker"><span class="phase-emblem" aria-hidden="true">${phaseBadge[0]}</span><span>Ход ${state.turn} · ${phaseBadge[1]}</span></div><div class="phase-title"><h2>${title}</h2><span class="timer" data-deadline="${ph.until}"></span></div><p class="phase-desc">${desc}</p><fieldset ${!enabled || busy ? "disabled" : ""} style="border:0;margin:0;padding:0;min-width:0">${body}</fieldset></section>`;
}
function playerDock() {
  return `<section class="player-dock" aria-label="Игроки">${state.players.map((p, index) => `<article class="player-glass ${p.id === state.active ? "active" : ""} ${p.out ? "out" : ""}" style="--player-color:${bank(p).color}"><span class="seat-number">${String(index + 1).padStart(2, "0")}</span>${p.id === state.active && !p.out ? '<span class="active-flag">ХОД</span>' : ""}<div class="row">${chip(p)}<strong>${e(p.name)}</strong></div><div class="dock-money">${money(p.cash)}</div><div class="dock-meta">${p.out ? "ВЫБЫЛ" : `⛲ ${fountains(state, p.id)}/4 · ◈ ${monopolies(state, p.id).length}/4`}${p.jail ? " · ▦ ТЮРЬМА" : ""}${p.loan ? ` · ЦБ ${money(p.loan.total)}` : ""}</div></article>`).join("")}</section>`;
}
const previewTable = createGame("preview-table", 2026);
function game() {
  const a = active(state),
    p = player(state, me);
  return `<header class="hud-top"><div class="hud-brand"><i aria-hidden="true">K</i><div>Kentopoly<span>TABLETOP EDITION</span></div></div><div class="turn-banner"><span class="turn-pulse" aria-hidden="true"></span><div><strong>${state.status === "finished" ? "Партия завершена" : e(a?.name) + ", твой ход"}</strong><span>${local ? "Один экран" : connected ? "Онлайн · до 6 игроков" : "Переподключение…"}</span></div><b>ХОД ${state.turn}</b></div><div class="hud-tools">${
    local
      ? `<label class="control-label" for="control-player">Игрок<select id="control-player">${state.players
          .filter((q) => !q.out)
          .map(
            (q) => `<option value="${q.id}" ${q.id === me ? "selected" : ""}>${e(q.name)}</option>`,
          )
          .join("")}</select></label>`
      : `<span class="my-bank">${chip(p)}${e(p.name)}</span>`
  }${btn("table-menu", "☰ Меню")}</div></header>${playerDock()}
<aside class="hud-actions" data-phase="${state.phase.type}" aria-label="Игровые действия">${state.status === "finished" ? `<section class="card finish"><h2>${state.winners.length ? state.winners.map((w) => e(player(state, w.id).name)).join(" и ") + " — победа!" : "Ничья"}</h2><p>${state.winners.map((w) => w.reasons.join(" + ")).join(" · ")}</p>${btn("home", "Новая партия")}</section>` : actionPanel()}<div class="asset-switch">${btn("toggle-asset", (assetOpen ? "− " : "+ ") + e(state.tiles[selected]?.name || "Объект"), false, false, 'aria-expanded="' + assetOpen + '"')}</div>${assetOpen ? `<div class="asset-inspector">${assetCard()}</div>` : ""}</aside>
<footer class="hud-bottom"><div class="camera-buttons">${btn("camera-overview", "◎ Поле", false, false, 'aria-label="Общий вид поля"')}${btn("camera-follow", followState ? "⌖ Фишка ✓" : "⌖ Фишка", false, false, 'id="follow-toggle"')}${btn("camera-left", "↶", false, false, 'aria-label="Поворот влево"')}${btn("camera-right", "↷", false, false, 'aria-label="Поворот вправо"')}${btn("camera-zoom-in", "+", false, false, 'aria-label="Приблизить"')}${btn("camera-zoom-out", "−", false, false, 'aria-label="Отдалить"')}</div><label class="tile-picker-label" for="tile-picker"><span>Цель</span><select id="tile-picker">${state.tiles.map((t) => `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${t.id} · ${e(t.name)}</option>`).join("")}</select></label><div class="history-controls">${btn("history-back", "‹ Ранее")}${btn("history-latest", "Сейчас ›")}</div></footer>
<div id="board-chronicle" class="board-chronicle" aria-label="Хроника на поле"></div><div id="dice-result" class="dice-result" aria-live="polite"></div><div id="camera-status" class="camera-status"></div><div id="hover-tile" class="sr-only"></div><div id="pawn-caption" class="pawn-caption"></div><div class="sr-only" aria-live="polite">${e(state.log.at(-1)?.text || "")}</div>`;
}
function render() {
  const playing = !!state && screen === "game" && state.status !== "lobby";
  document.body.classList.toggle("is-playing", playing);
  const entry = playing
    ? ""
    : `<header class="entry-title"><i aria-hidden="true">K</i><div>Kentopoly<span>ЭКОНОМИЧЕСКАЯ НАСТОЛКА</span></div></header><div class="entry-slogan"><strong>Твой стол.<br>Твои кенты.<br>Твоя империя.</strong><span>2–6 игроков · 40 клеток · один победитель</span></div><div class="entry-overlay">${screen === "home" || !state ? home().replace(/<section class="intro">[\s\S]*?<\/section>/, "") : lobby()}</div>`;
  root.innerHTML = `<main class="table-world ${playing ? "live-table" : "entry-table"}"><div id="scene-host"></div>${playing ? game() : entry}${sceneError ? `<section class="graphics-error"><h2>Нужна поддержка 3D</h2><p>${e(sceneError)}</p><p>Включи аппаратное ускорение браузера или открой игру на устройстве с WebGL. Резервного поля больше нет.</p>${btn("retry-graphics", "Повторить")}</section>` : ""}</main>`;
  updateTimers();
  if (!sceneError)
    try {
      if (!boardScene)
        boardScene = createBoardScene({
          onSelect(id) {
            if (!state || screen !== "game" || state.status === "lobby") return;
            selected = id;
            assetOpen = true;
            render();
          },
          onModeChange(mode) {
            followState = mode === "follow";
            const b = document.querySelector("#follow-toggle");
            if (b) b.textContent = followState ? "Следить ✓" : "Следить";
          },
          onError(message) {
            sceneError = message;
            boardScene?.destroy();
            boardScene = null;
            render();
          },
        });
      document.querySelector("#scene-host").append(boardScene.canvas);
      boardScene.update(
        playing ? state : previewTable,
        playing ? me : null,
        playing ? selected : -1,
      );
      boardScene.setHistoryOffset(historyOffset);
    } catch (error) {
      sceneError = error.message;
      boardScene?.destroy();
      boardScene = null;
      render();
    }
}
function receive(data) {
  if (state && state.id === data.state.id && data.state.version < state.version) return;
  state = migrateTableLayout(data.state);
  me = data.me;
  if (data.invite) joinToken = data.invite;
  screen = "game";
  if (["purchase", "auction", "takeover"].includes(state.phase.type)) selected = state.phase.tile;
  render();
}
function localUpdate(next) {
  const old = full?.active;
  full = migrateTableLayout(next);
  if (!me || old !== full.active || player(full, me)?.out) me = full.active;
  state = publicState(full, me);
  screen = "game";
  try {
    full.savedAt = Date.now();
    localStorage.setItem("kentopoly-alpha-save", JSON.stringify(full));
  } catch {}
  if (["purchase", "auction", "takeover"].includes(state.phase.type)) selected = state.phase.tile;
  render();
}
function startLocal() {
  stream?.close();
  stream = null;
  local = true;
  const n = Number(document.querySelector("#local-count")?.value || 3),
    name = document.querySelector("#nickname")?.value || "Кент",
    chosenBank = val("bank-choice") || BANKS[0].id,
    chosenPawn = val("pawn-choice") || PAWNS[0].id,
    localBanks = [BANKS.find((b) => b.id === chosenBank), ...BANKS.filter((b) => b.id !== chosenBank)],
    localPawns = [PAWNS.find((p) => p.id === chosenPawn), ...PAWNS.filter((p) => p.id !== chosenPawn)];
  let g = createGame("local", rng(4294967296));
  for (let i = 0; i < n; i++) {
    addPlayer(
      g,
      "p" + i,
      i === 0 ? name : ["Друг", "Сосед", "Коллега", "Бизнесмен", "Легенда"][i - 1],
      localBanks[i].id,
      localPawns[i].id,
    );
    g.players[i].ready = true;
  }
  g = apply(g, "p0", { type: "start" }, Date.now(), rng);
  full = null;
  me = null;
  selected = 0;
  localUpdate(g);
}
async function api(url, data) {
  const opts = data
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    : {};
  const res = await fetch(url, opts);
  const result = await res.json();
  if (!res.ok) {
    if (result.state) receive(result);
    throw Error(result.error || "Ошибка сервера");
  }
  return result;
}
function connect() {
  stream?.close();
  stream = new EventSource("/api/events");
  stream.onopen = () => {
    connected = true;
    render();
  };
  stream.onmessage = (ev) => {
    connected = true;
    receive(JSON.parse(ev.data));
  };
  stream.onerror = () => {
    connected = false;
    render();
  };
}
async function send(command) {
  if (busy) return;
  busy = true;
  try {
    if (local) localUpdate(apply(full, me, command, Date.now(), rng));
    else {
      if (!connected) throw Error("Нет связи с сервером");
      const commandId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      receive(await api("/api/cmd", { commandId, version: state.version, command }));
    }
    closeDialog();
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
    render();
  }
}
function dialog(title, body, actions = "") {
  modalRoot.innerHTML = `<div class="modal-shade"><section role="dialog" aria-modal="true" aria-labelledby="modal-title" class="modal"><h2 id="modal-title">${e(title)}</h2>${body}<div class="actions">${btn("close-dialog", "Закрыть")}${actions}</div></section></div>`;
  modalRoot.querySelector("input,select,button")?.focus();
}
function closeDialog() {
  modalRoot.innerHTML = "";
  confirmCommand = null;
}
function confirmAction(title, text, command) {
  confirmCommand = command;
  dialog(title, `<p>${text}</p>`, btn("confirm-command", "Подтвердить", true));
}
const ids = (name) =>
  [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => Number(x.value));
function checks(list, name) {
  return `<div class="checks">${list.length ? list.map((t) => `<label class="check"><input type="checkbox" name="${name}" value="${t.id}">${e(t.name)} · ${money(t.price)}${state.award === t.id ? " ★" : ""}</label>`).join("") : '<p class="smalltext muted">Нет имущества</p>'}</div>`;
}
function tradeDialog(to) {
  const others = state.players.filter((p) => !p.out && p.id !== me);
  to = to || others[0]?.id;
  if (!to) return;
  dialog(
    "Предложить обмен",
    `<label for="trade-to">Кому</label><select id="trade-to">${others.map((p) => `<option value="${e(p.id)}" ${p.id === to ? "selected" : ""}>${e(p.name)}</option>`).join("")}</select><label>Отдаю имущество</label>${checks(assets(state, me), "trade-give")}<label for="trade-pay">И деньги ($)</label><input type="number" id="trade-pay" value="0" min="0" step="1000"><label>Получаю имущество</label>${checks(assets(state, to), "trade-take")}<label for="trade-receive">И деньги ($)</label><input type="number" id="trade-receive" value="0" min="0" step="1000"><p class="smalltext muted below">Уровни и кубок остаются на зданиях. Получатель должен согласиться в течение 20 секунд.</p>`,
    btn("submit-trade", "Отправить предложение", true),
  );
}
const val = (id) => document.getElementById(id)?.value;
async function handle(action, target) {
  switch (action) {
    case "camera-overview":
      boardScene?.overview();
      break;
    case "camera-follow":
      boardScene?.toggleFollow();
      break;
    case "camera-left":
      boardScene?.rotate(-0.22);
      break;
    case "camera-right":
      boardScene?.rotate(0.22);
      break;
    case "camera-zoom-in":
      boardScene?.zoom(0.9);
      break;
    case "camera-zoom-out":
      boardScene?.zoom(1.1);
      break;
    case "toggle-asset":
      assetOpen = !assetOpen;
      render();
      break;
    case "history-back":
      historyOffset = Math.min(Math.max(0, state.log.length - 1), historyOffset + 1);
      boardScene?.setHistoryOffset(historyOffset);
      break;
    case "history-latest":
      historyOffset = 0;
      boardScene?.setHistoryOffset(0);
      break;
    case "retry-graphics":
      sceneError = "";
      boardScene?.destroy();
      boardScene = null;
      render();
      break;
    case "table-menu":
      dialog(
        "За этим столом",
        `<div class="stack">${btn("portfolio", "Мой портфель")}${btn("rules", "Правила")}${state?.status === "playing" && me === state.active ? btn("surrender", "Выйти из партии") : ""}${btn("home", "Лобби / новая партия")}</div><p class="smalltext muted">Только игровые деньги. Онлайн требует работающего сервера.</p>`,
      );
      break;
    case "tab-create":
      homeTab = "create";
      render();
      break;
    case "tab-join":
      homeTab = "join";
      render();
      break;
    case "home":
      closeDialog();
      screen = "home";
      render();
      break;
    case "switch-local":
      stream?.close();
      local = true;
      screen = "home";
      render();
      break;
    case "start-local":
      startLocal();
      break;
    case "resume-local":
      if (full) {
        me = full.active;
        localUpdate(full);
      }
      break;
    case "new-local":
      screen = "home";
      render();
      break;
    case "create-online":
    case "join-online": {
      try {
        let invite = val("invite-input") || joinToken;
        try {
          invite = new URL(invite).searchParams.get("join") || invite;
        } catch {}
        const data = await api(action === "create-online" ? "/api/create" : "/api/join", {
          name: val("nickname"),
          bank: val("bank-choice"),
          pawn: val("pawn-choice"),
          invite,
        });
        local = false;
        receive(data);
        connect();
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "home-bank":
    case "home-pawn": {
      const kind = action.slice(5),
        input = document.querySelector(`#${kind}-choice`),
        grid = target.closest(".choice-grid");
      if (input) input.value = target.dataset.value;
      for (const option of grid?.querySelectorAll(".choice-card") || []) {
        const chosen = option === target;
        option.classList.toggle("chosen", chosen);
        option.setAttribute("aria-pressed", String(chosen));
      }
      break;
    }
    case "lobby-bank":
      await send({ type: "bank", bank: target.dataset.value });
      break;
    case "lobby-pawn":
      await send({ type: "pawn", pawn: target.dataset.value });
      break;
    case "copy-invite": {
      const link = location.origin + location.pathname + "?join=" + joinToken;
      try {
        await navigator.clipboard.writeText(link);
        toast("Приглашение скопировано");
      } catch {
        dialog("Ссылка-приглашение", `<input readonly value="${e(link)}">`);
      }
      break;
    }
    case "rules":
      dialog(
        "Как играть в Kentopoly",
        `<p><strong>Три победы:</strong> собрать 4 фонтана, 4 полные цветовые пары или остаться последним игроком.</p><p>Старт: $1 000 000. Проход через Начало: +$150 000. Поиск телепортирует без зарплаты.</p><p>Фонтан стоит $200 000. Комиссия за каждый: $20 000 / $50 000 / $100 000 при 1 / 2 / 3 фонтанах.</p><p>Бизнес: базовая комиссия 10% цены. Уровни ×1 / ×1,75 / ×2,75 / ×4, полная группа ×1,5, один общий кубок Awards ×2. Округление до $1 000 вверх.</p><p>Принудительный выкуп: после комиссии заплати владельцу 2 × (цена + стоимость уровней). Не для фонтанов.</p><p>При долге есть 120 секунд: продать лот друзьям, получить кредит ЦБ или самому продать имущество банку. Кредит: до $500 000 на нехватку, 10% разово, возврат в пятый следующий свой ход.</p><p>3D: перетаскивание поворачивает камеру, колёсико меняет масштаб. Автокамера следует за движущейся фишкой и возвращается к общему виду. Кнопка «Общий вид» сбрасывает ракурс. При reduced-motion сопровождение отключено. Это альфа, не законченный MVP: нет фирменной графики, автоматического исключения AFK, управления хозяином и переноса места на другое устройство. Подробности в README архива.</p>`,
      );
      break;
    case "portfolio":
    case "liquidate": {
      const own = assets(state, me);
      dialog(
        action === "portfolio" ? "Твой портфель" : "Выбери имущество",
        own.length
          ? own
              .map(
                (t) =>
                  `<div class="playerline"><div class="grow"><strong>${e(t.name)}${state.award === t.id ? " ★" : ""}</strong><span class="smalltext muted">Уровень ${t.level} · банку ${money(liquidation(t))}</span></div>${btn("select-asset", "Открыть", false, false, `data-id="${t.id}"`)}</div>`,
              )
              .join("")
          : "<p>Пока нет недвижимости. Впереди целое поле.</p>",
      );
      break;
    }
    case "select-asset":
      assetOpen = true;
      selected = Number(target.dataset.id);
      closeDialog();
      render();
      document
        .querySelector(".selection-title")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      break;
    case "journal":
      closeDialog();
      historyOffset = 0;
      boardScene?.setHistoryOffset(0);
      break;
    case "close-dialog":
      closeDialog();
      break;
    case "confirm-command": {
      const c = confirmCommand;
      await send(c);
      break;
    }
    case "ready":
    case "start":
    case "roll":
    case "buy":
    case "auction":
    case "skip":
    case "end":
    case "repay":
      await send({ type: action });
      break;
    case "bid":
      await send({ type: "bid", amount: Number(val("bid-cash")) });
      break;
    case "pass-bid":
      await send({ type: "bid", amount: 0 });
      break;
    case "jail-roll":
    case "jail-pay":
    case "jail-card":
      await send({ type: "jail", choice: action.slice(5) });
      break;
    case "go-selected":
      confirmAction(
        "Переместиться?",
        `Цель: <strong>${e(state.tiles[selected].name)}</strong>. Сработает полный эффект клетки. Зарплаты за телепорт нет.`,
        { type: "search", tile: selected },
      );
      break;
    case "claim-award":
      await send({ type: "award", tile: Number(val("award-target")) });
      break;
    case "award-selected":
      await send({ type: "award", tile: selected });
      break;
    case "upgrade":
      await send({ type: "upgrade", tile: Number(target.dataset.id) });
      break;
    case "sell-level":
    case "sell-property": {
      const id = Number(target.dataset.id),
        t = state.tiles[id],
        levelOnly = action === "sell-level";
      confirmAction(
        "Продать банку?",
        `${e(t.name)}: получишь ${money(levelOnly ? t.price / 4 : liquidation(t))}. ${!levelOnly && state.award === id ? "Кубок вернётся на церемонию." : ""}`,
        { type: "sell", tile: id, levelOnly },
      );
      break;
    }
    case "takeover": {
      const t = state.tiles[state.phase.tile];
      confirmAction(
        "Принудительный выкуп",
        `${e(t.name)}: ${money(buyout(t))} получит ${e(player(state, t.owner).name)}. Комиссия уже оплачена, уровни и кубок остаются на здании.`,
        { type: "takeover" },
      );
      break;
    }
    case "loan": {
      const p = player(state, me),
        n = state.phase.amount - p.cash,
        total = n + Math.ceil(n / 10000) * 1000;
      confirmAction(
        "Договор с игровым ЦБ",
        `Заём: <strong>${money(n)}</strong>, сразу на оплату текущего долга. Вернуть <strong>${money(total)}</strong> в начале своего хода №${p.ownTurn + 5}, включая тюремные ходы. Досрочное погашение не уменьшает разовую плату.`,
        { type: "loan", principal: n, total },
      );
      break;
    }
    case "rescue-lot":
      dialog(
        "Лот для спасения",
        `<p>Выбери активы. Другие игроки предложат деньги или деньги с имуществом. Ты сам решаешь, какое предложение принять.</p>${checks(assets(state, me), "rescue-lot")}`,
        btn("submit-lot", "Выставить лот", true),
      );
      break;
    case "submit-lot":
      await send({ type: "rescueLot", ids: ids("rescue-lot") });
      break;
    case "cancel-lot":
      await send({ type: "cancelLot" });
      break;
    case "make-rescue-offer":
      dialog(
        "Сделка за лот",
        `<p>${state.rescue.ids.map((id) => e(state.tiles[id].name)).join(", ")}</p><label for="rescue-cash">Деньги должнику ($)</label><input id="rescue-cash" type="number" min="1000" step="1000" value="100000"><label>Дополнительно отдаю имущество</label>${checks(assets(state, me), "rescue-give")}<p class="smalltext muted below">Деньги резервируются до ответа, отзыва или истечения 30 секунд.</p>`,
        btn("submit-rescue", "Отправить предложение", true),
      );
      break;
    case "submit-rescue":
      await send({
        type: "rescueOffer",
        cash: Number(val("rescue-cash")),
        give: ids("rescue-give"),
      });
      break;
    case "withdraw-offer":
      await send({ type: "withdrawOffer" });
      break;
    case "accept-rescue":
      confirmAction(
        "Принять сделку?",
        `Лот перейдёт ${e(player(state, target.dataset.bidder).name)}. Проверь деньги и получаемые объекты в предложении.`,
        { type: "acceptRescue", bidder: target.dataset.bidder },
      );
      break;
    case "trade":
      tradeDialog();
      break;
    case "submit-trade":
      await send({
        type: "trade",
        to: val("trade-to"),
        give: ids("trade-give"),
        take: ids("trade-take"),
        pay: Number(val("trade-pay")),
        receive: Number(val("trade-receive")),
      });
      break;
    case "accept-trade":
      await send({ type: "acceptTrade" });
      break;
    case "reject-trade":
      await send({ type: "rejectTrade" });
      break;
    case "cancel-trade":
      await send({ type: "cancelTrade" });
      break;
    case "surrender":
      confirmAction(
        "Завершить свою игру?",
        `Ты выбываешь. Имущество и деньги распределятся по правилам банкротства, кредит ЦБ не исчезнет без расчёта. Вернуться в эту партию нельзя.`,
        { type: "surrender" },
      );
      break;
  }
}
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-action],[data-tile]");
  if (!t || t.disabled) return;
  if (t.dataset.tile !== undefined) {
    selected = Number(t.dataset.tile);
    render();
    return;
  }
  Promise.resolve(handle(t.dataset.action, t)).catch((err) => toast(err.message));
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "tile-picker") {
    selected = Number(ev.target.value);
    assetOpen = true;
    render();
  }
  if (ev.target.id === "control-player") {
    me = ev.target.value;
    state = publicState(full, me);
    render();
  }
  if (ev.target.id === "search-target") {
    selected = Number(ev.target.value);
    assetOpen = true;
    render();
  }
  if (ev.target.id === "trade-to") tradeDialog(ev.target.value);
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeDialog();
  if (ev.key === "Tab" && modalRoot.firstChild) {
    const focus = [...modalRoot.querySelectorAll("button:not(:disabled),input,select")];
    const first = focus[0],
      last = focus.at(-1);
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last?.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first?.focus();
    }
  }
});
function updateTimers() {
  for (const el of document.querySelectorAll("[data-deadline]"))
    el.textContent =
      Math.max(0, Math.ceil((Number(el.dataset.deadline) - Date.now()) / 1000)) + " с";
}
setInterval(() => {
  updateTimers();
  if (local && full?.status === "playing" && screen === "game") {
    try {
      const next = tick(full, Date.now(), rng);
      if (next) localUpdate(next);
    } catch (err) {
      toast("Ошибка таймера: " + err.message);
    }
  }
}, 500);
try {
  const saved = localStorage.getItem("kentopoly-alpha-save");
  if (saved) {
    full = JSON.parse(saved);
    if (full.status === "playing") {
      const pause = Date.now() - (full.savedAt || Date.now());
      full.phase.until += pause;
      if (full.trade) full.trade.until += pause;
      if (full.rescue) for (const o of full.rescue.offers) o.until += pause;
    }
  }
} catch {
  full = null;
}
render();
if (!STANDALONE) {
  api("/api/me")
    .then((data) => {
      if (!joinToken || joinToken === data.invite) {
        receive(data);
        connect();
      }
    })
    .catch(() => {});
}
window.addEventListener("beforeunload", () => {
  if (local && full) {
    try {
      full.savedAt = Date.now();
      localStorage.setItem("kentopoly-alpha-save", JSON.stringify(full));
    } catch {}
  }
});
